// build-timeline.js — construct absolute timeline from comic-script.json + real mp3 durations
// Usage: node scripts/build-timeline.js
// No wall-clock dependency: sceneDur = max(leadIn + sum(audio) + tail, minHold/holdMs).
// Transition convention: scene.transition = transition ENTERING this scene (from previous).
// totalMs = sum(sceneDur) - sum(entering transitions of scenes[1..]).
// Writes output/timeline-<ep>.json.

'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output');
const epIdx = process.argv.indexOf('--ep');
const EP = (epIdx !== -1 && process.argv[epIdx + 1]) || process.env.COMIC_EP || 'ep01';
const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'comic-script-' + EP + '.json'), 'utf8'));
const m = script.meta;
const audioDir = path.join(ROOT, ...m.audioDir.split('/'));
const videoDir = path.join(ROOT, ...(m.videoDir || ('assets/video/' + EP)).split('/'));

function probeDur(file) {
  if (!fs.existsSync(file)) return 0;
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const d = parseFloat((r.stdout || '').trim());
  return isNaN(d) ? 0 : d;
}

const leadIn = m.defaults.leadInMs;
const tail = m.defaults.tailMs;
const minHold = m.defaults.minHoldMs;

// pass 1: per-scene durations + local audio events
const rows = [];
for (const s of script.scenes) {
  const audioEvents = [];
  let t = leadIn;
  for (let i = 0; i < (s.audio || []).length; i++) {
    const a = s.audio[i];
    const file = path.join(audioDir, s.id + '-' + i + '.mp3');
    const durMs = Math.round(probeDur(file) * 1000);
    // optional delayMs: extra gap after the previous line — lets lines be
    // beat-synced to rapid cuts (e.g. s02 montage commentary four-liner)
    const delayMs = a.delayMs || 0;
    audioEvents.push({ role: a.role, text: a.text, file: s.id + '-' + i + '.mp3', localStartMs: t + delayMs, durMs });
    t += durMs + delayMs;
  }
  // video clips (Veo image-to-video) win over camera moves: if the declared
  // clip exists, scene duration must hold it (inMs/outMs select a slice).
  let vEffMs = 0;
  if (s.video && s.video.file) {
    const vd = probeDur(path.join(videoDir, s.video.file));
    if (vd > 0) vEffMs = Math.round((s.video.outMs || vd * 1000) - (s.video.inMs || 0));
  }
  let durMs;
  if (s.duration.strategy === 'fixed') durMs = s.duration.holdMs;
  else durMs = Math.max(t + tail, vEffMs, s.duration.holdMs || minHold);
  rows.push({ scene: s, durMs, audioEvents });
}

// pass 2: absolute positions (transition i enters scene i, i > 0)
const scenes = [];
let cursor = 0;
rows.forEach((row, i) => {
  const s = row.scene;
  const trans = s.transition || m.defaults.transition;
  if (i > 0) cursor -= trans.durMs;
  const startMs = cursor;
  const floralEvents = [];
  for (const f of (s.florals || [])) {
    floralEvents.push({ text: f.text, style: f.style, pos: f.pos, startMs: startMs + f.tMs, durMs: f.durMs });
  }
  if (s.type === 'montage') {
    const sub = row.durMs / s.image.altImages.length;
    s.image.altImages.forEach((ai, k) => {
      if (ai.floral) floralEvents.push({
        text: ai.floral.text, style: ai.floral.style, pos: ai.floral.pos,
        startMs: startMs + Math.round(k * sub) + ai.floral.tMs, durMs: ai.floral.durMs
      });
    });
  }
  const audioEvents = row.audioEvents.map(a => ({
    role: a.role, text: a.text, file: a.file, startMs: startMs + a.localStartMs, durMs: a.durMs
  }));
  scenes.push({
    id: s.id, type: s.type, startMs, durMs: row.durMs,
    cameraMode: s.camera.mode, camera: s.camera,
    transition: trans,
    image: s.image, product: s.product, background: s.background, sfx: s.sfx || [],
    video: s.video || null,
    audioEvents, floralEvents
  });
  cursor = startMs + row.durMs;
});

const totalMs = cursor;
const timeline = { meta: { episode: m.episode, title: m.title, width: m.width, height: m.height, fps: m.fps }, scenes, totalMs };
fs.writeFileSync(path.join(OUT, 'timeline-' + EP + '.json'), JSON.stringify(timeline, null, 2), 'utf8');
console.log('timeline-' + EP + '.json written: ' + scenes.length + ' scenes, total ' + (totalMs / 1000).toFixed(2) + 's');
