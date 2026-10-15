# tts.py - multi-role voiceover synthesis for AsCodingComic
# Usage: python scripts/tts.py [--ep epXX] [--force]
# Reads comic-script-<ep>.json, one mp3 per audio event:
#   assets/audio/<ep>/<sceneId>-<i>.mp3
# Voice/rate resolved per role (characters table), env override:
#   COMIC_TTS_VOICE_<ROLE> / COMIC_TTS_RATE_<ROLE> / COMIC_TTS_VOICE / COMIC_TTS_RATE
# Existing mp3s are skipped unless --force. Retries 3x (3s/6s apart),
# failures logged to output/tts-errors-<ep>.log, exit 1 if any line failed.

import asyncio
import json
import os
import re
import subprocess
import sys

import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def resolve_ep():
    """--ep <value> or COMIC_EP env; default ep01 (mirrors the node scripts)."""
    if '--ep' in sys.argv:
        i = sys.argv.index('--ep')
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return os.environ.get('COMIC_EP', 'ep01')


EP = resolve_ep()
SCRIPT = os.path.join(ROOT, 'comic-script-%s.json' % EP)
ERROR_LOG = os.path.join(ROOT, 'output', 'tts-errors-%s.log' % EP)
FORCE = '--force' in sys.argv


def trim_silence(path):
    """Strip edge-tts leading/trailing silence and resample to 44.1k mono.
    silenceremove was tried first but it cuts mid-sentence at comma pauses
    (e.g. s11 truncated from 3.2s to 0.35s) — so instead: silencedetect to
    find the REAL voice boundaries, then atrim precisely, keep 0.15s tail pad.
    Timeline math assumes voice starts at t=0 of the mp3; long tails (up to
    47% of short lines) would otherwise land V7 midpoints in silence."""
    def detect():
        r = subprocess.run(
            ['ffmpeg', '-hide_banner', '-i', path,
             '-af', 'silencedetect=noise=-45dB:d=0.15', '-f', 'null', '-'],
            capture_output=True, text=True)
        segs = []  # [start, end] silence segments
        cur = None
        for line in r.stderr.splitlines():
            ms = re.search(r'silence_start: ([\d.]+)', line)
            if ms:
                cur = [float(ms.group(1))]
                continue
            me = re.search(r'silence_end: ([\d.]+)', line)
            if me and cur is not None:
                cur.append(float(me.group(1)))
                segs.append(cur)
                cur = None
        return segs

    def duration():
        r = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'csv=p=0', path], capture_output=True, text=True)
        try:
            return float(r.stdout.strip())
        except ValueError:
            return 0.0

    dur = duration()
    if dur <= 0:
        return
    segs = detect()
    # leading silence: segment starting at ~0 and ending early
    start = segs[0][1] if segs and segs[0][0] < 0.05 and segs[0][1] < 0.6 else 0.0
    # trailing silence: last segment reaching end of file (mp3 frame padding
    # can shift decoded EOF by up to ~0.1s vs ffprobe duration)
    end = segs[-1][0] if segs and abs(dur - segs[-1][1]) < 0.15 else dur
    if end - start < 0.2:  # degenerate — keep original
        return
    if start < 0.02 and end >= dur - 0.05:
        # no silence to trim; still normalize format
        end = dur
    end = min(end + 0.15, dur)  # small natural tail pad
    tmp = path + '.trim.mp3'
    r = subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error', '-i', path,
         '-af', 'atrim=start=%f:end=%f,asetpts=N/SR/TB' % (start, end),
         '-ar', '44100', '-ac', '1', '-b:a', '128k', tmp],
        capture_output=True)
    if r.returncode == 0 and os.path.getsize(tmp) > 0:
        os.replace(tmp, path)
        print('  trim %s: %.2fs -> %.2fs' % (os.path.basename(path), dur, end - start))
    else:
        print('  trim skipped for %s (ffmpeg failed, keeping original)' % os.path.basename(path))
        if os.path.exists(tmp):
            os.remove(tmp)


def load_script():
    with open(SCRIPT, 'r', encoding='utf-8') as f:
        return json.load(f)


def resolve_voice(role, ch, ev):
    upper = role.upper()
    voice = (os.environ.get('COMIC_TTS_VOICE_' + upper)
             or os.environ.get('COMIC_TTS_VOICE')
             or ch[role].get('voice', 'zh-CN-XiaoxiaoNeural'))
    # emotion support: per-event rate/pitch override the character default
    rate = (ev.get('rate')
            or os.environ.get('COMIC_TTS_RATE_' + upper)
            or os.environ.get('COMIC_TTS_RATE')
            or ch[role].get('rate', '+0%'))
    pitch = (ev.get('pitch') or ch[role].get('pitch'))
    return voice, rate, pitch


async def synth(text, voice, rate, pitch, path):
    """Try up to 3 times; return error string or None."""
    errors = []
    kwargs = {'rate': rate}
    if pitch:
        kwargs['pitch'] = pitch
    for attempt in (1, 2, 3):
        if attempt > 1:
            await asyncio.sleep((attempt - 1) * 3)
        try:
            await edge_tts.Communicate(text, voice, **kwargs).save(path)
            return None
        except Exception as e:  # noqa: BLE001
            errors.append('%s (attempt %d)' % (e, attempt))
    return '; '.join(errors)


async def main():
    script = load_script()
    ch = script['characters']
    audio_dir = os.path.join(ROOT, *script['meta']['audioDir'].split('/'))
    os.makedirs(audio_dir, exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'output'), exist_ok=True)

    total = 0
    done = 0
    failures = []

    for scene in script['scenes']:
        for i, a in enumerate(scene.get('audio', [])):
            total += 1
            path = os.path.join(audio_dir, '%s-%d.mp3' % (scene['id'], i))
            voice, rate, pitch = resolve_voice(a['role'], ch, a)
            if os.path.exists(path) and not FORCE:
                done += 1
                print('skip %s (exists)' % os.path.basename(path))
                continue
            print('[%s @%s p%s] %s | %s' % (voice, rate, pitch or '-', os.path.basename(path), a['text']))
            err = await synth(a['text'], voice, rate, pitch, path)
            if err:
                failures.append('%s: %s' % (os.path.basename(path), err))
            else:
                trim_silence(path)
                done += 1

    with open(ERROR_LOG, 'w', encoding='utf-8') as f:
        for line in failures:
            f.write(line + '\n')

    print('TTS done: %d/%d ok' % (done, total))
    if failures:
        print('%d failed, see %s' % (len(failures), ERROR_LOG))
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())
