// make-bgm.js — assemble assets/audio/bgm-<ep>.mp3 from the three CC-BY candidate
// tracks, mapped to the timeline's narrative phases:
//   opener    (s01..body-1):  Ossuary 6 - Air      (eerie)
//   body      (body..product):Finding the Balance  (ancient, light)
//   deduction (product..end): Volatile Reaction    (suspense drive)
// Segments are resampled to 48k stereo, trimmed to phase length, joined with
// 2s triangular crossfades, loudness-normalized to -20 LUFS and faded in/out
// at the head/tail. Output is exactly the timeline total so the render can
// apad/atrim it safely. Run after build-timeline.js (reads output/timeline-<ep>.json).
// Phase boundary scene ids / track list / xfade live in the episode json
// (meta.bgm.phases / meta.bgm.tracks / meta.bgm.xfade).
// License: tracks are CC-BY Kevin MacLeod (incompetech.com) — attribution
// required in the deliverable notes.

'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CAND = path.join(ROOT, 'assets', 'audio', 'bgm-candidates');
const epIdx = process.argv.indexOf('--ep');
const EP = (epIdx !== -1 && process.argv[epIdx + 1]) || process.env.COMIC_EP || 'ep01';
const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'comic-script-' + EP + '.json'), 'utf8'));
const bgmCfg = (script.meta && script.meta.bgm) || {};
const OUT_FILE = path.join(ROOT, 'assets', 'audio', 'bgm-' + EP + '.mp3');
const TRACKS = bgmCfg.tracks || ['Ossuary 6 - Air.mp3', 'Finding the Balance.mp3', 'Volatile Reaction.mp3'];
const XF = bgmCfg.xfade || 2; // crossfade seconds at each seam

function ff(args, label) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) { console.log('FAILED ' + label + ': ' + (r.stderr || '').slice(-400)); process.exit(1); }
}

const tl = JSON.parse(fs.readFileSync(path.join(ROOT, 'output', 'timeline-' + EP + '.json'), 'utf8'));
const total = tl.totalMs / 1000;
for (const t of TRACKS) {
  if (!fs.existsSync(path.join(CAND, t))) { console.log('missing candidate: ' + t); process.exit(1); }
}

// phase boundaries: opener ends at meta.bgm.phases.body start, body ends at meta.bgm.phases.product start
const phases = bgmCfg.phases || { body: 's03-confused', product: 's09-open-sunlike' };
const s3 = tl.scenes.find(s => s.id === phases.body);
const s9 = tl.scenes.find(s => s.id === phases.product);
const b1 = s3 ? s3.startMs / 1000 : total / 3;
const b2 = s9 ? s9.startMs / 1000 : total * 2 / 3;
// segment lengths include the crossfade overlap so the joined result = total:
// l1 + l2 - XF + l3 - XF = total  ->  l1 = b1 + XF/2, l2 = b2 - b1 + XF, l3 = total - b2 + XF/2
const l1 = b1 + XF / 2, l2 = b2 - b1 + XF, l3 = total - b2 + XF / 2;
const n = v => String(Math.round(v * 1e6) / 1e6);
const resample = 'aresample=48000,aformat=channel_layouts=stereo';

const fc = [
  '[0:a]' + resample + ',atrim=0:' + n(l1) + ',asetpts=PTS-STARTPTS[a0]',
  '[1:a]' + resample + ',atrim=0:' + n(l2) + ',asetpts=PTS-STARTPTS[a1]',
  '[2:a]' + resample + ',atrim=0:' + n(l3) + ',asetpts=PTS-STARTPTS[a2]',
  '[a0][a1]acrossfade=d=' + XF + ':c1=tri:c2=tri[x1]',
  '[x1][a2]acrossfade=d=' + XF + ':c1=tri:c2=tri[x2]',
  '[x2]loudnorm=I=-20:TP=-1.5:LRA=7,' +
    'afade=t=in:st=0:d=1.5,afade=t=out:st=' + n(total - 1.5) + ':d=1.5,' +
    'atrim=0:' + n(total) + '[out]'
].join(';');

ff(['-i', path.join(CAND, TRACKS[0]), '-i', path.join(CAND, TRACKS[1]), '-i', path.join(CAND, TRACKS[2]),
  '-filter_complex', fc, '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '192k', OUT_FILE],
  'bgm assemble');

const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT_FILE], { encoding: 'utf8' });
console.log('DONE ' + OUT_FILE + '  (timeline ' + n(total) + 's, bgm ' + n(parseFloat(r.stdout.trim())) + 's, phases ' + n(b1) + '/' + n(b2) + ')');
