// build-render.js — render output/<ep>.mp4 from timeline-<ep>.json + assets
// Usage: node scripts\build-render.js [--ep epXX] [--placeholders]
// Per scene: -loop 1 image -> 4x(startZoom) lanczos pre-scale -> zoompan (absolute z expr,
// smoothstep-eased zoom/pan, optional handheld shake, constant 30fps) -> N frames -> clip mp4.
// Montage = 4 sub-clips concat (hard cuts, no overlap drift).
// Then: xfade chain (offset = scene.startMs/1000) + adelay/amix audio + subtitles burn.
// --placeholders: missing images replaced by deterministic solid-color pngs (dry-run).

'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output');
const epIdx = process.argv.indexOf('--ep');
const EP = (epIdx !== -1 && process.argv[epIdx + 1]) || process.env.COMIC_EP || 'ep01';
// per-episode clip dirs: scene ids repeat across episodes, plain ids would collide
const CLIPS = path.join(OUT, 'clips', EP);
const PH = path.join(OUT, 'placeholders', EP);
const SFX_DIR = path.join(ROOT, 'assets', 'sfx');
const FPS = 30;
const PLACEHOLDERS = process.argv.includes('--placeholders');

const tl = JSON.parse(fs.readFileSync(path.join(OUT, 'timeline-' + EP + '.json'), 'utf8'));
const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'comic-script-' + EP + '.json'), 'utf8'));
const IMG_DIR = path.join(ROOT, ...script.meta.imageDir.split('/'));
const VIDEO_DIR = path.join(ROOT, ...(script.meta.videoDir || ('assets/video/' + EP)).split('/'));

function ff(args, label) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    console.log('FAILED ' + label + ': ' + (r.stderr || '').slice(-400));
    process.exit(1);
  }
  return r;
}
function fp(args, label) {
  const r = spawnSync('ffprobe', ['-v', 'error', ...args], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) { console.log('ffprobe FAILED ' + label); process.exit(1); }
  return r.stdout.trim();
}

// ---------------------------------------------------------------------------
// source image resolution per scene
// ---------------------------------------------------------------------------
function srcImage(scene) {
  if (scene.type === 'product') return path.join(ROOT, 'assets', 'product', scene.product.file);
  if (scene.type === 'textcard') return null; // generated bg
  return path.join(IMG_DIR, scene.image.file);
}
function placeholderFor(scene, sub) {
  const p = path.join(PH, scene.id + (sub !== undefined ? '-' + sub : '') + '.png');
  if (!fs.existsSync(p)) {
    let h = 0;
    for (const c of scene.id + (sub !== undefined ? String(sub) : '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const color = h.toString(16).padStart(6, '0').slice(0, 6);
    ff(['-f', 'lavfi', '-i', 'color=c=0x' + color + ':s=1920x1080', '-frames:v', '1', p], 'placeholder ' + p);
  }
  return p;
}
function resolveImage(scene, sub) {
  let f = sub !== undefined ? path.join(IMG_DIR, sub.file) : srcImage(scene);
  if (scene.type === 'textcard') {
    const bg = path.join(CLIPS, 'textcard-bg.png');
    if (!fs.existsSync(bg)) ff(['-f', 'lavfi', '-i', 'color=c=' + scene.background + ':s=1920x1080', '-frames:v', '1', bg], 'textcard bg');
    return bg;
  }
  if (f && fs.existsSync(f)) return f;
  if (PLACEHOLDERS) { console.log('WARN placeholder: ' + path.basename(f || scene.id)); return placeholderFor(scene, sub); }
  console.log('MISSING image: ' + f + '  (run gen-images.js, or --placeholders for dry-run)');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// zoompan clip
// ---------------------------------------------------------------------------
function num(v) { return String(Math.round(v * 1e6) / 1e6); }
function renderClip(outFile, img, cam, durMs) {
  const N = Math.max(2, Math.round(durMs * FPS / 1000));
  const K = 4 * cam.startZoom; // pre-scale headroom (anti-jitter)
  const sx = cam.startFrac.x, sy = cam.startFrac.y, ex = cam.endFrac.x, ey = cam.endFrac.y;
  const zStart = num(cam.startZoom), zEnd = num(cam.endZoom);
  const prog = 'min(on/' + (N - 1) + ',1)';
  // smoothstep easing for cinematic starts/stops; linear prog for crash/snappy moves
  const e = cam.ease === 'smooth' ? '((' + prog + ')*(' + prog + ')*(3-2*(' + prog + ')))' : prog;
  const zoomExpr = 'max(0.4,min(3,' + zStart + '+(' + zEnd + '-' + zStart + ')*' + e + '))';
  const amp = cam.shakeAmp ? num(cam.shakeAmp) : '0';
  // handheld jitter: 3 detuned sines on x, 3 cosines on y (amp = fraction of input size)
  const shakeX = amp !== '0' ? '+(' + amp + '*iw*(sin(on*0.7)+0.6*sin(on*1.53)+0.4*sin(on*3.1)))' : '';
  const shakeY = amp !== '0' ? '+(' + amp + '*ih*(cos(on*0.6)+0.6*cos(on*1.7)+0.4*cos(on*2.9)))' : '';
  const xExpr = 'max(0,min(iw-iw/zoom,(' + num(sx) + '+(' + num(ex) + '-' + num(sx) + ')*' + e + ')*iw-iw/zoom/2' + shakeX + '))';
  const yExpr = 'max(0,min(ih-ih/zoom,(' + num(sy) + '+(' + num(ey) + '-' + num(sy) + ')*' + e + ')*ih-ih/zoom/2' + shakeY + '))';
  const vf = 'scale=iw*' + num(K) + ':ih*' + num(K) + ':flags=lanczos,' +
    'zoompan=z=\'' + zoomExpr + '\':x=\'' + xExpr + '\':y=\'' + yExpr + '\':d=1:s=1920x1080:fps=' + FPS +
    ',format=yuv420p';
  ff(['-loop', '1', '-framerate', String(FPS), '-i', img,
    '-vf', vf, '-frames:v', String(N), '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', outFile],
    'clip ' + path.basename(outFile));
  return N;
}

// ---------------------------------------------------------------------------
// real-motion video clip (Veo image-to-video output; no zoompan needed)
// ---------------------------------------------------------------------------
function renderVideoClip(outFile, video, cam, durMs, inMs) {
  const N = Math.max(2, Math.round(durMs * FPS / 1000));
  // Veo clips are fixed-length (8s); a dialogue-heavy scene can outrun its
  // slice. Play the slice once, then freeze the last frame for the remainder
  // (tpad clone) — stream-looping would visibly restart the action.
  const srcDurMs = Math.round(parseFloat(fp(['-show_entries', 'format=duration', '-of', 'csv=p=0', video], 'video dur')) * 1000);
  const availMs = Math.min(durMs, Math.max(0, srcDurMs - inMs));
  const holdMs = Math.max(0, durMs - availMs);
  const vf = 'scale=1920:1080:flags=lanczos,fps=' + FPS + ',setsar=1' +
    (holdMs > 50 ? ',tpad=stop_mode=clone:stop_duration=' + num(holdMs / 1000) : '') +
    ',format=yuv420p';
  // -t must sit BEFORE -i (input-side: read only the available slice) — after -i
  // it caps OUTPUT duration and truncates the tpad freeze (ep02 s03: clip 8.0s
  // vs timeline 9.65s starved the xfade chain, killing the video stream at 20.67s).
  // +50ms read tolerance: input -t drops the frame whose pts lands exactly on t,
  // so a cut on a source-frame boundary (availMs 5000 = 24fps frame #120) lost
  // one frame vs the old output-side -t; the slack restores identical clips.
  ff(['-ss', num(inMs / 1000), '-t', num((availMs + 50) / 1000), '-i', video,
    '-vf', vf, '-frames:v', String(N),
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', outFile],
    'video clip ' + path.basename(outFile));
  return N;
}

// ---------------------------------------------------------------------------
// per-scene clips
// ---------------------------------------------------------------------------
fs.mkdirSync(CLIPS, { recursive: true });
fs.mkdirSync(PH, { recursive: true });
fs.mkdirSync(SFX_DIR, { recursive: true });
const clipFiles = [];
for (const sc of tl.scenes) {
  const outFile = path.join(CLIPS, sc.id + '.mp4');
  if (sc.type === 'montage') {
    const sub = Math.round(sc.durMs / sc.image.altImages.length); // 1400
    const subs = [];
    sc.image.altImages.forEach((ai, k) => {
      const subFile = path.join(CLIPS, sc.id + '-sub' + k + '.mp4');
      renderClip(subFile, resolveImage(sc, ai), ai.camera, sub);
      subs.push(subFile);
    });
    const listFile = path.join(CLIPS, sc.id + '-list.txt');
    fs.writeFileSync(listFile, subs.map(f => 'file ' + path.basename(f)).join('\n'));
    ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outFile], 'montage concat ' + sc.id);
    clipFiles.push(outFile);
  } else if (sc.video && sc.video.file && fs.existsSync(path.join(VIDEO_DIR, sc.video.file))) {
    renderVideoClip(outFile, path.join(VIDEO_DIR, sc.video.file), sc.camera, sc.durMs, sc.video.inMs || 0);
    clipFiles.push(outFile);
  } else {
    renderClip(outFile, resolveImage(sc), sc.camera, sc.durMs);
    clipFiles.push(outFile);
  }
}

// ---------------------------------------------------------------------------
// sfx (generated once, deterministic lavfi)
// ---------------------------------------------------------------------------
function ensureSfx(name, args) {
  const f = path.join(SFX_DIR, name + '.wav');
  if (!fs.existsSync(f)) ff(args.concat([f]), 'sfx ' + name);
  return f;
}
const sfxByScene = { wind: {}, thud: {}, ding: {} };
for (const sc of tl.scenes) {
  if (!sc.sfx || !sc.sfx.length) continue;
  for (const s of sc.sfx) sfxByScene[s][sc.id] = sc;
}
const sfxDefs = {
  wind: (d) => ['-f', 'lavfi', '-i', 'anoisesrc=color=brown:d=' + num(d / 1000) + ':amplitude=0.25',
    '-af', 'lowpass=f=500,afade=t=in:st=0:d=0.8,afade=t=out:st=' + num(d / 1000 - 1.2) + ':d=1.2'],
  thud: () => ['-f', 'lavfi', '-i', 'sine=f=70:d=0.9', '-af', 'afade=t=out:st=0.05:d=0.85,volume=0.6'],
  ding: () => ['-f', 'lavfi', '-i', 'sine=f=1318.5:d=1.6', '-af', 'afade=t=out:st=0.9:d=0.7,volume=0.25']
};
const sfxInputs = []; // {file, delayMs}
for (const name of ['wind', 'thud', 'ding']) {
  const users = Object.values(sfxByScene[name]);
  if (!users.length) continue;
  const file = ensureSfx(name, sfxDefs[name](users[0].durMs));
  for (const sc of users) sfxInputs.push({ file, delayMs: sc.startMs });
}

// ---------------------------------------------------------------------------
// xfade chain + audio mix
// ---------------------------------------------------------------------------
const TRANS = ['fade', 'fadewhite', 'fadeblack', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'dissolve', 'slideleft', 'slideright', 'zoomin'];
let filter = '';
let prev = '0:v';
for (let i = 1; i < clipFiles.length; i++) {
  const out = i === clipFiles.length - 1 ? 'vout' : 'v' + i;
  const t = TRANS.includes(tl.scenes[i].transition.name) ? tl.scenes[i].transition.name : 'fade';
  const dur = num(tl.scenes[i].transition.durMs / 1000);
  const off = num(tl.scenes[i].startMs / 1000);
  filter += '[' + prev + '][' + i + ':v]xfade=transition=' + t + ':duration=' + dur + ':offset=' + off + '[' + out + '];';
  prev = out;
}

// audio inputs: mp3 events then sfx; bgm handled separately below
const audioIns = []; // {file, delayMs, vol}
for (const sc of tl.scenes) {
  for (const ev of sc.audioEvents) {
    audioIns.push({ file: path.join(ROOT, ...script.meta.audioDir.split('/'), ev.file), delayMs: ev.startMs, vol: 1 });
  }
}
for (const s of sfxInputs) audioIns.push({ file: s.file, delayMs: s.delayMs, vol: 1 });
const bgm = path.join(ROOT, 'assets', 'audio', 'bgm-' + EP + '.mp3');
const hasBgm = fs.existsSync(bgm);

const amixIns = [];
const vidCount = clipFiles.length;
audioIns.forEach((a, k) => {
  const idx = vidCount + k;
  const lbl = 'a' + k;
  const chain = '[' + idx + ':a]' + (a.vol !== 1 ? 'volume=' + a.vol + ',' : '') + 'adelay=' + a.delayMs + ':all=1[' + lbl + ']';
  filter += chain + ';';
  amixIns.push('[' + lbl + ']');
});
// bgm: pre-leveled to -20 LUFS by make-bgm.js; 0.25 vol sits ~12dB under the
// dialogue; apad/atrim pin it to the timeline total. The final loudnorm pushes
// the whole mix to reference loudness (compare.mp4: -12 LUFS, ours was -25).
if (hasBgm) {
  filter += '[' + (vidCount + audioIns.length) + ':a]volume=0.25,adelay=0:all=1,apad,atrim=0:' + num(tl.totalMs / 1000) + '[abgm];';
}
filter += amixIns.join('') + (hasBgm ? '[abgm]' : '') + 'amix=inputs=' + (amixIns.length + (hasBgm ? 1 : 0)) +
  ':normalize=0:dropout_transition=0,aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-14:TP=-1.5:LRA=11[aout]';

// dialogue-only mix (no bgm, no loudnorm) for the V7 speech-boundary probe —
// continuous BGM would defeat silencedetect on the final track. NOTE: the
// adelay chains must be defined in THIS command's filtergraph (the [aN]
// labels are command-local) — the original version referenced the main
// command's labels and produced a broken 8s pile-up that V7 could not see.
if (hasBgm) {
  const dlgMix = path.join(OUT, EP + '-dialogue-mix.m4a');
  const dlgChains = audioIns.map((a, k) =>
    '[' + (clipFiles.length + k) + ':a]' + (a.vol !== 1 ? 'volume=' + a.vol + ',' : '') +
    'adelay=' + a.delayMs + ':all=1[a' + k + ']').join(';');
  const dlgFilter = dlgChains + (dlgChains ? ';' : '') + amixIns.join('') +
    'amix=inputs=' + amixIns.length + ':normalize=0:dropout_transition=0,apad,atrim=0:' +
    num(tl.totalMs / 1000) + ',aformat=sample_rates=48000:channel_layouts=stereo[adlg]';
  const dlgInputs = [];
  for (const f of clipFiles) dlgInputs.push('-i', f);
  for (const a of audioIns) dlgInputs.push('-i', a.file);
  ff([...dlgInputs, '-filter_complex', dlgFilter, '-map', '[adlg]', '-c:a', 'aac', '-b:a', '192k', dlgMix],
    'dialogue-only mix (V7 probe)');
}

const inputs = [];
for (const f of clipFiles) inputs.push('-i', f);
for (const a of audioIns) inputs.push('-i', a.file);
if (hasBgm) inputs.push('-i', bgm);

const tmp = path.join(OUT, 'tmp-' + EP + '-nosub.mp4');
ff([...inputs, '-filter_complex', filter, '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', tmp],
  'xfade + audio mix');

// ---------------------------------------------------------------------------
// subtitles burn + final
// ---------------------------------------------------------------------------
const assRel = 'output/' + EP + '-subs.ass';
const final = path.join(OUT, EP + '.mp4');
ff(['-i', tmp, '-vf', 'subtitles=filename=\'' + assRel + '\'',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'copy', '-movflags', '+faststart', final],
  'subtitles burn');
fs.unlinkSync(tmp);

const durOut = fp(['-show_entries', 'format=duration', '-of', 'csv=p=0', final], 'final duration');
console.log('DONE ' + final + '  (' + num(parseFloat(durOut)) + 's, timeline ' + num(tl.totalMs / 1000) + 's)');
