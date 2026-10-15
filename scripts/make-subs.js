// make-subs.js — SRT (human review) + ASS (burn-in: dialogue/narration/florals) from timeline-<ep>.json
// Usage: node scripts/make-subs.js [--ep epXX]
// Outputs: output/<ep>-dialogue.srt, output/<ep>-subs.ass
// Emoji rule: no astral-plane chars anywhere in subtitle text (florals/dialogue are pre-checked by V0).

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output');
const epIdx = process.argv.indexOf('--ep');
const EP = (epIdx !== -1 && process.argv[epIdx + 1]) || process.env.COMIC_EP || 'ep01';
const tl = JSON.parse(fs.readFileSync(path.join(OUT, 'timeline-' + EP + '.json'), 'utf8'));

// ---------------------------------------------------------------------------
// time helpers
// ---------------------------------------------------------------------------
function assTime(ms) {
  // Always 3-field H:MM:SS.CC — libass 0.17 rejects 2-field times ("Bad timestamp")
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const min = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  return String(h) + ':' + String(min).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
}
function srtTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const min = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const msr = total % 1000;
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ',' + String(msr).padStart(3, '0');
}

// ---------------------------------------------------------------------------
// sentence splitter: <=22 chars per cue, 2 lines max per cue block
// ---------------------------------------------------------------------------
const SPLIT_RE = /([^。！？…]*[。！？…])/g;
function splitSentences(text) {
  const parts = text.match(SPLIT_RE) || [];
  const joined = parts.join('');
  const rest = text.slice(joined.length);
  const out = parts.filter(p => p.length > 0);
  if (rest) out.push(rest);
  // merge into chunks <=22 chars
  const chunks = [];
  let cur = '';
  for (const p of out) {
    if ((cur + p).length <= 22 || !cur) { cur += p; continue; }
    chunks.push(cur); cur = p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ---------------------------------------------------------------------------
// SRT
// ---------------------------------------------------------------------------
const srtCues = [];
for (const sc of tl.scenes) {
  for (const ev of sc.audioEvents) {
    const chunks = splitSentences(ev.text);
    const totalChars = ev.text.length || 1;
    let t = ev.startMs;
    for (const ch of chunks) {
      const dur = Math.max(400, Math.round(ev.durMs * ch.length / totalChars));
      srtCues.push({ start: t, end: Math.min(t + dur, ev.startMs + ev.durMs), text: ch });
      t += dur;
    }
  }
}
srtCues.sort((a, b) => a.start - b.start);
let srt = '';
srtCues.forEach((c, i) => {
  srt += (i + 1) + '\n' + srtTime(c.start) + ' --> ' + srtTime(c.end) + '\n' + c.text + '\n\n';
});
fs.writeFileSync(path.join(OUT, EP + '-dialogue.srt'), srt, 'utf8');

// ---------------------------------------------------------------------------
// ASS
// ---------------------------------------------------------------------------
const POS_MAP = {
  title: { 'top-center': [960, 110], 'center': [960, 420] },
  note: { 'top-left': [300, 130], 'bottom-right': [1640, 890], 'bottom-center': [960, 880], 'center': [960, 650] },
  impact: { 'bottom-center': [960, 840], 'bottom-right': [1640, 840] },
  slogan: { 'top': [960, 400], 'bottom': [960, 640] }
};
function posOf(f) {
  const map = POS_MAP[f.style] || {};
  return map[f.pos] || [960, 540];
}

const header = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 1920',
  'PlayResY: 1080',
  'WrapStyle: 2',
  'ScaledBorderAndShadow: yes',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  // uniform subtitle system: all spoken lines (dialogue + narrator) = one style,
  // YaHei 48 white bottom-center with identical 2px outline (2026-08-24 user review:
  // no top/bottom split, no size/color/outline variance); florals keep 46/68 sizes with uniform 4px outline
  'Style: Dialogue,Microsoft YaHei,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,30,30,56,1',
  'Style: FloralTitle,SimHei,46,&H0000D7FF,&H0000D7FF,&H000000FF,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,5,0,0,0,1',
  'Style: FloralNote,SimHei,46,&H003BEBFF,&H003BEBFF,&H000000FF,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,5,0,0,0,1',
  'Style: FloralImpact,SimHei,46,&H00FFFFFF,&H00FFFFFF,&H000000FF,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,5,0,0,0,1',
  'Style: FloralSlogan,SimHei,68,&H0000D7FF,&H0000D7FF,&H000000FF,&H80000000,-1,0,0,0,100,100,0,0,1,4,3,5,0,0,0,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
];

const events = [];
for (const sc of tl.scenes) {
  for (const ev of sc.audioEvents) {
    const style = 'Dialogue';
    events.push('Dialogue: 0,' + assTime(ev.startMs) + ',' + assTime(ev.startMs + ev.durMs) + ',' + style + ',,0,0,0,,' + ev.text);
  }
  for (const f of sc.floralEvents) {
    const [x, y] = posOf(f);
    const ovr = '{\\an5\\pos(' + x + ',' + y + ')}';
    const style = 'Floral' + f.style.charAt(0).toUpperCase() + f.style.slice(1);
    events.push('Dialogue: 0,' + assTime(f.startMs) + ',' + assTime(f.startMs + f.durMs) + ',' + style + ',,0,0,0,,' + ovr + f.text);
  }
}
events.sort();
const ass = header.join('\n') + '\n' + events.join('\n') + '\n';
fs.writeFileSync(path.join(OUT, EP + '-subs.ass'), ass, 'utf8');

console.log('subs written: ' + EP + '-dialogue.srt (' + srtCues.length + ' cues), ' + EP + '-subs.ass (' + events.length + ' events)');
