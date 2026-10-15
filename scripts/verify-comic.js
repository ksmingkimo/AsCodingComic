// verify-comic.js — machine-checkable verification suite for AsCodingComic
// Usage: node scripts/verify-comic.js [--ep epXX] [--skip-images] [--skip-audio] [--skip-video]
// Exit code 1 if any FAIL. Report written to output/verify/verify-<ep>-report.txt

'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output');
const VERIFY_DIR = path.join(OUT, 'verify');
const epIdx = process.argv.indexOf('--ep');
const EP = (epIdx !== -1 && process.argv[epIdx + 1]) || process.env.COMIC_EP || 'ep01';
const SCRIPT_PATH = path.join(ROOT, 'comic-script-' + EP + '.json');
const PLOT_SRC = path.join(ROOT, '剧情脚本.md');
const VIDEO = path.join(OUT, EP + '.mp4');

const args = process.argv.slice(2);
const SKIP_IMAGES = args.includes('--skip-images');
const SKIP_AUDIO = args.includes('--skip-audio');
const SKIP_VIDEO = args.includes('--skip-video');

const results = [];
function add(id, name, status, note) { results.push({ id, name, status, note: note || '' }); }

function ffprobeJson(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch (e) { return null; }
}

// normalize text: strip punctuation/quotes/whitespace for matching
function norm(text) {
  return String(text).replace(/[『』「」"'，。！？…、\s（）()]/g, '');
}

function hasAstral(text) {
  return /[\u{10000}-\u{10FFFF}]/u.test(String(text));
}

// ---------------------------------------------------------------------------
// V0 schema: comic-script.json structural + consistency with 剧情脚本.md
// ---------------------------------------------------------------------------
function v0Schema() {
  let script;
  try {
    script = JSON.parse(fs.readFileSync(SCRIPT_PATH, 'utf8'));
  } catch (e) {
    add('V0', 'schema', 'FAIL', 'comic-script-' + EP + '.json 解析失败: ' + e.message);
    return null;
  }
  const problems = [];
  const m = script.meta, sc = script.scenes, ch = script.characters;
  if (!m || !sc || !ch) problems.push('meta/scenes/characters 缺失');
  const ids = new Set();
  const generated = new Set();
  for (const s of sc) {
    if (ids.has(s.id)) problems.push('重复 scene id: ' + s.id);
    ids.add(s.id);
    if (!['image', 'montage', 'product', 'composite', 'textcard'].includes(s.type)) problems.push(s.id + ': 非法 type');
    if (!s.camera || !['zoomIn', 'zoomOut', 'pushIn', 'crashZoom', 'pullBack', 'dollyIn', 'dollyPan', 'punchIn', 'trackPan', 'panUp', 'panDown', 'panL', 'panR', 'panLeft', 'panRight', 'static'].includes(s.camera.mode)) problems.push(s.id + ': camera 缺失或 mode 非法');
    if (!s.duration || !s.duration.strategy) problems.push(s.id + ': duration 缺失');
    const trans = s.transition || (m.defaults && m.defaults.transition);
    if (trans && !['fade', 'fadewhite', 'fadeblack', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'dissolve', 'slideleft', 'slideright', 'zoomin'].includes(trans.name)) problems.push(s.id + ': 非法转场 ' + trans.name);
    for (const a of (s.audio || [])) {
      if (!ch[a.role]) problems.push(s.id + ': 未知角色 ' + a.role);
      if (hasAstral(a.text)) problems.push(s.id + ': 台词含 emoji: ' + a.text);
    }
    for (const f of (s.florals || [])) {
      if (hasAstral(f.text)) problems.push(s.id + ': 花字含 emoji: ' + f.text);
      if (!['title', 'note', 'impact', 'slogan'].includes(f.style)) problems.push(s.id + ': 花字非法 style');
    }
    if (s.type === 'image') {
      if (!s.image || !s.image.file) problems.push(s.id + ': image 缺 file');
      else if (!s.image.reuse) {
        generated.add(s.image.file);
        const p = s.image.prompt;
        if (!p || !p.zh || !p.en) problems.push(s.id + ': 出图缺 prompt.zh/en');
      }
    } else if (s.type === 'montage') {
      if (!s.image || !s.image.altImages || !s.image.altImages.length) problems.push(s.id + ': montage 缺 altImages');
      else for (const ai of s.image.altImages) {
        generated.add(ai.file);
        if (!ai.prompt || !ai.prompt.zh || !ai.prompt.en) problems.push(s.id + '/' + ai.file + ': 缺 prompt');
        if (!ai.camera) problems.push(s.id + '/' + ai.file + ': 缺 camera');
      }
    } else if (s.type === 'product') {
      if (!s.product || !s.product.file || !s.product.source) problems.push(s.id + ': product 缺 file/source');
    }
    if (s.video) {
      if (!s.video.file || !s.video.sourceImage) problems.push(s.id + ': video 缺 file/sourceImage');
      if (!s.video.actionPrompt || !s.video.actionPrompt.en) problems.push(s.id + ': video 缺 actionPrompt.en');
    }
  }
  // franchise slogan: meta.slogan required, last scene must end on it
  if (!m || !m.slogan) problems.push('meta.slogan 缺失（每集固定结尾特色）');
  if (sc && sc.length && !(sc[sc.length - 1].florals || []).some(f => f.style === 'slogan'))
    problems.push('结尾场景缺少 slogan 花字（每集固定结尾特色）');
  for (const r of (script.refs || [])) {
    if (!r.file || !r.char || !r.prompt || !r.prompt.zh || !r.prompt.en) problems.push('refs: ' + r.file + ' 缺字段');
    if (!ch[r.char]) problems.push('refs: 未知角色 ' + r.char);
  }
  // character consistency schema: anchors frozen on characters, roles declared
  // per image, roles covered by refs
  for (const [role, c] of Object.entries(ch)) {
    if (role === 'narrator') continue;
    if (!c.anchor || !c.anchor.zh || !c.anchor.en) problems.push('角色 ' + role + ' 缺 anchor 锚点短语');
  }
  for (const s of sc) {
    const im = s.image;
    if (!im || im.reuse) continue;
    const roleLists = im.altImages
      ? im.altImages.map(ai => ai.roles || [])
      : (im.prompt ? [im.roles || []] : []);
    for (const roles of roleLists) {
      for (const role of roles) {
        if (!ch[role]) { problems.push(s.id + ': roles 含未知角色 ' + role); continue; }
        // 规范名 ref-<role>.png，或带版本后缀的替代立绘 ref-<role>-v2.png（损坏立绘替代，见 方案设计.md）
        const hasRef = (refs) => (refs || []).some(r => r === 'ref-' + role + '.png' || r.startsWith('ref-' + role + '-'));
        if (!hasRef(im.refs) && !(im.altImages || []).some(ai => hasRef(ai.refs)))
          problems.push(s.id + ': role ' + role + ' 未挂参考图 ref-' + role + '.png');
      }
    }
  }
  const budget = (m && m.budget && m.budget.sceneImages) || 14;
  if (generated.size > budget) problems.push('出图数 ' + generated.size + ' 超过预算 ' + budget);
  // dialogue must match 剧情脚本.md exactly; whitelisted scenes are additions/paraphrases
  // recorded in 进度表.md 待确认问题 (per-episode list lives in meta.whitelist)
  const srcNorm = norm(fs.readFileSync(PLOT_SRC, 'utf8'));
  const whitelist = (m && m.whitelist) || [];
  for (const s of sc) {
    for (const a of (s.audio || [])) {
      if (whitelist.includes(s.id)) continue;
      if (!srcNorm.includes(norm(a.text))) problems.push(s.id + ': 台词与剧情脚本.md 不一致: ' + a.text);
    }
  }
  if (problems.length) add('V0', 'schema', 'FAIL', problems.join(' | '));
  else add('V0', 'schema', 'PASS', '场景 ' + sc.length + ' 个 / 出图 ' + generated.size + ' 张 / 对白与剧情脚本逐句一致');
  return script;
}

// ---------------------------------------------------------------------------
function v1Docs() {
  const need = ['方案设计.md', '进度表.md', '对话记录.md'];
  const missing = need.filter(f => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) add('V1', '治理文档', 'FAIL', '缺失: ' + missing.join(', '));
  else add('V1', '治理文档', 'PASS', '三文档齐全');
}

function v2Images(script) {
  if (SKIP_IMAGES) { add('V2', '图片', 'SKIP', '--skip-images'); return; }
  const need = [];
  for (const r of script.refs) need.push({ file: path.join(ROOT, script.meta.refDir, r.file), label: '立绘 ' + r.file });
  for (const s of script.scenes) {
    if (s.type === 'image' && s.image.file && !s.image.reuse) need.push({ file: path.join(ROOT, script.meta.imageDir, s.image.file), label: s.id });
    if (s.type === 'montage') for (const ai of s.image.altImages) need.push({ file: path.join(ROOT, script.meta.imageDir, ai.file), label: s.id + '/' + ai.file });
  }
  const problems = [];
  for (const n of need) {
    if (!fs.existsSync(n.file)) { problems.push(n.label + ': 缺文件'); continue; }
    const info = ffprobeJson(n.file);
    if (!info) { problems.push(n.label + ': ffprobe 失败'); continue; }
    const vs = info.streams.find(st => st.codec_type === 'video');
    if (!vs) { problems.push(n.label + ': 无视频流'); continue; }
    const w = vs.width, h = vs.height;
    if (w < 1600 || h < 900) problems.push(n.label + ': 分辨率不足 ' + w + 'x' + h);
    const dev = Math.abs((w / h) - (16 / 9)) / (16 / 9);
    if (dev > 0.02) problems.push(n.label + ': 宽高比偏离16:9 (' + (w / h).toFixed(3) + ')');
  }
  if (problems.length) add('V2', '图片', 'FAIL', problems.join(' | '));
  else add('V2', '图片', 'PASS', need.length + ' 张全部合格');
}

function v3Audio(script) {
  if (SKIP_AUDIO) { add('V3', '音频', 'SKIP', '--skip-audio'); return; }
  const problems = [];
  let count = 0;
  for (const s of script.scenes) {
    (s.audio || []).forEach((a, i) => {
      const file = path.join(ROOT, script.meta.audioDir, s.id + '-' + i + '.mp3');
      count++;
      if (!fs.existsSync(file)) { problems.push(s.id + '-' + i + ': 缺失'); return; }
      if (fs.statSync(file).size < 8192) { problems.push(s.id + '-' + i + ': 过小'); return; }
      const info = ffprobeJson(file);
      const d = info && info.format ? parseFloat(info.format.duration) : 0;
      if (!d || d < 0.3) problems.push(s.id + '-' + i + ': 时长异常 ' + d);
    });
  }
  if (count === 0) { add('V3', '音频', 'SKIP', '无台词音频事件'); return; }
  if (problems.length) add('V3', '音频', 'FAIL', problems.join(' | '));
  else add('V3', '音频', 'PASS', count + ' 段全部就绪');
}

function readTimeline() {
  const tl = path.join(OUT, 'timeline-' + EP + '.json');
  if (!fs.existsSync(tl)) return null;
  try { return JSON.parse(fs.readFileSync(tl, 'utf8')); } catch (e) { return null; }
}

function v4Duration() {
  if (SKIP_VIDEO) { add('V4', '成片时长', 'SKIP', '--skip-video'); return; }
  const t = readTimeline();
  if (!t) { add('V4', '成片时长', 'SKIP', 'timeline-' + EP + '.json 未生成'); return; }
  const dur = t.totalMs / 1000;
  // upper bound raised for Veo video scenes (min 8s each pushes total past 60s)
  if (dur >= 30 && dur <= 75) add('V4', '成片时长', 'PASS', dur.toFixed(1) + 's 在 30-75s 区间');
  else add('V4', '成片时长', 'FAIL', dur.toFixed(1) + 's 不在 30-75s 区间');
}

function v5Subs(script) {
  const srt = path.join(OUT, EP + '-dialogue.srt');
  const ass = path.join(OUT, EP + '-subs.ass');
  if (!fs.existsSync(srt) || !fs.existsSync(ass)) { add('V5', '字幕', 'SKIP', '字幕未生成'); return; }
  const problems = [];
  const srtText = fs.readFileSync(srt, 'utf8');
  const assText = fs.readFileSync(ass, 'utf8');
  // long lines are legally split into <=22-char cues; join the cue texts and
  // match the full line against the joined stream (cue index/timestamps dropped)
  const cueTexts = srtText.split(/\r?\n/).filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes('-->'));
  const joined = norm(cueTexts.join(''));
  for (const s of script.scenes) for (const a of (s.audio || [])) {
    if (!joined.includes(norm(a.text))) problems.push(s.id + ': 台词无 SRT cue');
  }
  for (const s of script.scenes) for (const f of (s.florals || [])) {
    if (!assText.includes(f.text)) problems.push(s.id + ': 花字无 ASS 事件: ' + f.text);
  }
  for (const [name, text] of [['SRT', srtText], ['ASS', assText]]) {
    if (hasAstral(text)) problems.push(name + ' 含 emoji');
  }
  if (problems.length) add('V5', '字幕', 'FAIL', problems.join(' | '));
  else add('V5', '字幕', 'PASS', '台词/花字全覆盖，无 emoji');
}

function v6Video(script) {
  if (!fs.existsSync(VIDEO)) { add('V6', '成片基础', 'SKIP', EP + '.mp4 未生成'); return; }
  const info = ffprobeJson(VIDEO);
  if (!info) { add('V6', '成片基础', 'FAIL', 'ffprobe 失败'); return; }
  const problems = [];
  const vs = info.streams.find(st => st.codec_type === 'video');
  const as = info.streams.find(st => st.codec_type === 'audio');
  if (!vs || vs.width !== 1920 || vs.height !== 1080) problems.push('非 1920x1080');
  if (!as) problems.push('无音轨');
  const t = readTimeline();
  if (t) {
    const dur = parseFloat(info.format.duration) * 1000;
    if (Math.abs(dur - t.totalMs) > 1500) problems.push('时长偏差 ' + Math.abs(dur - t.totalMs).toFixed(0) + 'ms > 1500ms');
  }
  if (problems.length) add('V6', '成片基础', 'FAIL', problems.join(' | '));
  else add('V6', '成片基础', 'PASS', '1920x1080 + 音轨 + 时长对齐');
}

// V7: speech segment boundaries vs timeline windows (tolerance 500ms)
function v7Speech(script) {
  if (!fs.existsSync(VIDEO)) { add('V7', '语音边界', 'SKIP', EP + '.mp4 未生成'); return; }
  const t = readTimeline();
  if (!t) { add('V7', '语音边界', 'SKIP', 'timeline-' + EP + '.json 未生成'); return; }
  // BGM would defeat silencedetect on the final track — probe the dialogue-only
  // mix that build-render writes alongside whenever bgm is mixed in
  const dlgMix = path.join(OUT, EP + '-dialogue-mix.m4a');
  const probe = fs.existsSync(dlgMix) ? dlgMix : VIDEO;
  // the probe must span the whole timeline — a short/broken track (e.g. the
  // old label bug that piled all lines at t=0) would make every window look
  // "covered" and blind this check
  const pd = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', probe], { encoding: 'utf8' });
  const probeDur = parseFloat((pd.stdout || '').trim());
  if (isNaN(probeDur) || probeDur < t.totalMs / 1000 * 0.8) {
    add('V7', '语音边界', 'FAIL', '探测轨时长异常 ' + probeDur + 's（应≈' + (t.totalMs / 1000).toFixed(1) + 's），探针不可信');
    return;
  }
  const r = spawnSync('ffmpeg', ['-i', probe, '-af', 'silencedetect=noise=-35dB:d=0.25', '-f', 'null', 'NUL'], { encoding: 'utf8' });
  const log = (r.stderr || '') + (r.stdout || '');
  const silStarts = [], silEnds = [];
  for (const line of log.split('\n')) {
    const ms = line.match(/silence_start: ([\d.]+)/);
    const me = line.match(/silence_end: ([\d.]+)/);
    if (ms) silStarts.push(parseFloat(ms[1]));
    if (me) silEnds.push(parseFloat(me[1]));
  }
  const speech = [];
  let cursor = 0;
  for (let i = 0; i < silStarts.length; i++) {
    if (silStarts[i] - cursor > 0.3) speech.push([cursor, silStarts[i]]);
    cursor = silEnds[i] || silStarts[i];
  }
  const totalDur = t.totalMs / 1000;
  if (totalDur - cursor > 0.3) speech.push([cursor, totalDur]);
  // Coverage check (>=50% of the event window covered by detected speech).
  // Midpoint-only was too fragile: mp3 tails / comma pauses could land the
  // midpoint in a detected silence gap even when voice was correctly placed.
  // Staccato exclamations (ep02 s03 「宗主！宗主！出大事了！！」: bursts of
  // 0.27–0.66s split by ~0.5s drama pauses) get eaten by the 0.25s dwell —
  // bridge sub-0.6s silences inside the window into the covered span. A real
  // missing/misplaced line leaves a ≥0.6s hole and still fails.
  const gaps = [];
  for (let i = 0; i < silStarts.length; i++) gaps.push([silStarts[i], silEnds[i] || silStarts[i]]);
  const problems = [];
  let events = 0;
  const coverage = (s1, e1) => {
    let total = 0;
    for (const [s, e] of speech) total += Math.max(0, Math.min(e, e1) - Math.max(s, s1));
    for (const [s, e] of gaps) {
      if (e - s >= 0.6) continue;
      total += Math.max(0, Math.min(e, e1) - Math.max(s, s1));
    }
    return total / (e1 - s1 || 1);
  };
  for (const sc of t.scenes) {
    for (const ev of (sc.audioEvents || [])) {
      events++;
      const s1 = ev.startMs / 1000, e1 = (ev.startMs + ev.durMs) / 1000;
      const ratio = coverage(s1, e1);
      if (ratio < 0.5) problems.push(sc.id + ': 语音覆盖率 ' + (ratio * 100).toFixed(0) + '% < 50%');
    }
  }
  if (events === 0) { add('V7', '语音边界', 'SKIP', 'timeline 无音频事件'); return; }
  if (problems.length) add('V7', '语音边界', 'FAIL', problems.join(' | '));
  else add('V7', '语音边界', 'PASS', events + ' 段语音全部覆盖事件窗口 >=50%');
}

// V8: per-scene luma evolution (moving scenes must change; static scenes must not be blank)
function v8Frozen(script) {
  if (!fs.existsSync(VIDEO)) { add('V8', '防冻结帧', 'SKIP', EP + '.mp4 未生成'); return; }
  const t = readTimeline();
  if (!t) { add('V8', '防冻结帧', 'SKIP', 'timeline-' + EP + '.json 未生成'); return; }
  fs.mkdirSync(VERIFY_DIR, { recursive: true });
  const statFile = 'sig-' + EP + '.txt';
  // relative path avoids Windows drive-colon escaping inside filter graph
  const r = spawnSync('ffmpeg', ['-i', VIDEO, '-vf', 'signalstats,metadata=print:file=' + statFile, '-f', 'null', 'NUL'], { encoding: 'utf8', cwd: VERIFY_DIR });
  if (r.status !== 0) { add('V8', '防冻结帧', 'FAIL', 'signalstats 运行失败'); return; }
  const raw = fs.readFileSync(path.join(VERIFY_DIR, statFile), 'utf8');
  const points = [];
  let curT = -1;
  for (const line of raw.split('\n')) {
    const tm = line.match(/pts_time:([\d.]+)/);
    if (tm) curT = parseFloat(tm[1]);
    const ym = line.match(/YAVG=([\d.]+)/);
    if (ym && curT >= 0) { points.push([curT, parseFloat(ym[1])]); curT = -1; }
  }
  if (points.length < 10) { add('V8', '防冻结帧', 'FAIL', '采样点不足 ' + points.length); return; }
  const problems = [];
  for (const sc of t.scenes) {
    const a = sc.startMs / 1000 + sc.durMs * 0.15 / 1000;
    const b = sc.startMs / 1000 + sc.durMs * 0.85 / 1000;
    const seg = points.filter(p => p[0] >= a && p[0] <= b).map(p => p[1]);
    if (!seg.length) { problems.push(sc.id + ': 场景内无采样帧'); continue; }
    const moving = sc.cameraMode !== 'static' && sc.type !== 'textcard' && !sc.video;
    if (moving) {
      const range = Math.max.apply(null, seg) - Math.min.apply(null, seg);
      if (range < 1.0) problems.push(sc.id + ': 运镜场景 YAVG 范围仅 ' + range.toFixed(2));
    } else {
      const mid = seg[Math.floor(seg.length / 2)];
      if (mid <= 5 || mid >= 245) problems.push(sc.id + ': 静止场景 YAVG=' + mid.toFixed(1) + ' 疑似纯黑/纯白');
    }
  }
  if (problems.length) add('V8', '防冻结帧', 'FAIL', problems.join(' | '));
  else add('V8', '防冻结帧', 'PASS', t.scenes.length + ' 个场景全部有画面演变/非空白');
}

// V9: raw gray frame luma stddev at scene midpoint (>8 = not blank)
function v9Frames(script) {
  if (!fs.existsSync(VIDEO)) { add('V9', '抽帧非空白', 'SKIP', EP + '.mp4 未生成'); return; }
  const t = readTimeline();
  if (!t) { add('V9', '抽帧非空白', 'SKIP', 'timeline-' + EP + '.json 未生成'); return; }
  const problems = [];
  for (const sc of t.scenes) {
    const sec = (sc.startMs + sc.durMs / 2) / 1000;
    const r = spawnSync('ffmpeg', ['-ss', sec.toFixed(2), '-i', VIDEO, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { encoding: null, maxBuffer: 32 * 1024 * 1024 });
    if (r.status !== 0 || !r.stdout || r.stdout.length < 1000) { problems.push(sc.id + ': 抽帧失败'); continue; }
    const buf = r.stdout;
    let sum = 0, sq = 0, n = buf.length;
    for (let i = 0; i < n; i++) { sum += buf[i]; sq += buf[i] * buf[i]; }
    const mean = sum / n;
    const stddev = Math.sqrt(sq / n - mean * mean);
    if (stddev <= 8) problems.push(sc.id + ': 抽帧亮度 stddev=' + stddev.toFixed(2) + ' 疑似空白');
  }
  if (problems.length) add('V9', '抽帧非空白', 'FAIL', problems.join(' | '));
  else add('V9', '抽帧非空白', 'PASS', t.scenes.length + ' 个场景抽帧全部非空白');
}

// V10: upstream untouched (best effort — only when AsCoding is a git repo)
function v10Upstream() {
  const upstream = path.join(ROOT, '..', 'AsCoding');
  const r = spawnSync('git', ['-C', upstream, 'status', '--porcelain'], { encoding: 'utf8' });
  if (r.status !== 0) { add('V10', '上游零改动', 'SKIP', 'AsCoding 非 git 仓库或 git 不可用'); return; }
  if (r.stdout.trim() === '') add('V10', '上游零改动', 'PASS', 'AsCoding 工作区干净');
  else add('V10', '上游零改动', 'FAIL', 'AsCoding 有未提交改动，需排查');
}

// V11: character color signature — each character-bearing image must contain
// the ref-derived signature colors of every declared role (>=0.6% of pixels).
// Smoke test for gross drift (robe/outfit color swaps); face/body drift is
// caught by the anchor prompts + contact-sheet human gate instead.
function readRgb24(file, vf, maxBytes) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: null, maxBuffer: maxBytes || 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return null;
  return r.stdout;
}
function v11CharacterColors(script) {
  if (SKIP_IMAGES) { add('V11', '角色色块', 'SKIP', '--skip-images'); return; }
  const jobs = [];
  for (const s of script.scenes) {
    const im = s.image;
    if (!im || im.reuse) continue;
    if (im.altImages) {
      for (const ai of im.altImages) if ((ai.roles || []).length) jobs.push({ file: ai.file, roles: ai.roles, label: s.id + '/' + ai.file });
    } else if (im.prompt && (im.roles || []).length) {
      jobs.push({ file: im.file, roles: im.roles, label: s.id });
    }
  }
  if (!jobs.length) { add('V11', '角色色块', 'SKIP', '无带角色出图镜头'); return; }

  // signature colors per char: top-5 non-background histogram buckets of ref center
  const sigCache = {};
  function signatures(char) {
    if (sigCache[char]) return sigCache[char];
    sigCache[char] = [];
    const ref = script.refs.find(r => r.char === char);
    if (!ref) return sigCache[char];
    const refFile = path.join(ROOT, script.meta.refDir, ref.file);
    // 整图统计（2026-08-25 修复：旧立绘角色不居画面中心，中心 40% 裁剪只能拿到背景，
    // 签名全是浅灰导致 V11 假 PASS/误判「损坏」，见 方案设计.md）
    const buf = readRgb24(refFile, 'null');
    if (!buf) return sigCache[char];
    const hist = new Int32Array(4096);
    const n = Math.floor(buf.length / 3);
    for (let i = 0; i < n; i++) {
      const r = buf[3 * i], g = buf[3 * i + 1], b = buf[3 * i + 2];
      hist[(r >> 4) * 256 + (g >> 4) * 16 + (b >> 4)]++;
    }
    const sorted = [];
    for (let k = 0; k < 4096; k++) if (hist[k]) sorted.push([hist[k], k]);
    sorted.sort((a, b) => b[0] - a[0]);
    // Skip near-white/near-black background buckets. Skip near-neutral grey too
    // (studio background is grey-white; a character's own grey robe would be
    // near-neutral, so fall back to the loose filter if the strict one yields
    // too few buckets). Chroma>40 would filter out photoreal grey robes (guoba)
    // entirely — grey IS his signature color. V11 stays a tripwire, not a proof.
    const pick = (strict) => {
      const out = [];
      for (const [, k] of sorted) {
        const r = ((k >> 8) & 15) * 16 + 8, g = ((k >> 4) & 15) * 16 + 8, b = (k & 15) * 16 + 8;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mn > 235 || mx < 45) continue; // near-white/near-black = ref background
        if (strict && mx - mn < 20) continue; // near-neutral grey = studio background
        out.push([r, g, b]);
        if (out.length >= 5) break;
      }
      return out;
    };
    sigCache[char] = pick(true);
    if (sigCache[char].length < 3) sigCache[char] = pick(false);
    return sigCache[char];
  }

  const problems = [];
  for (const job of jobs) {
    const f = path.join(ROOT, script.meta.imageDir, job.file);
    if (!fs.existsSync(f)) { problems.push(job.label + ': 缺文件'); continue; }
    const buf = readRgb24(f, 'null');
    if (!buf) { problems.push(job.label + ': 解码失败'); continue; }
    const n = Math.floor(buf.length / 3);
    for (const role of job.roles) {
      const sigs = signatures(role);
      if (!sigs.length) { problems.push(job.label + ': 角色 ' + role + ' 立绘签名不可用'); continue; }
      let hit = 0;
      for (let i = 0; i < n; i++) {
        const r = buf[3 * i], g = buf[3 * i + 1], b = buf[3 * i + 2];
        for (const [sr, sg, sb] of sigs) {
          if (Math.abs(r - sr) <= 25 && Math.abs(g - sg) <= 25 && Math.abs(b - sb) <= 25) { hit++; break; }
        }
      }
      const ratio = hit / n;
      if (ratio < 0.006) problems.push(job.label + ': 角色 ' + role + ' 锚点色占比 ' + (ratio * 100).toFixed(2) + '% < 0.6%');
    }
  }
  if (problems.length) add('V11', '角色色块', 'FAIL', problems.join(' | '));
  else add('V11', '角色色块', 'PASS', jobs.length + ' 张带角色图锚点色全部命中');
}

// V12: Veo image-to-video clips — declared in comic-script.json, file must
// exist, be >=4s, and be >=1280x720 (source 1080p or 720p, upscaled in render)
function v12VideoClips(script) {
  if (SKIP_IMAGES) { add('V12', '视频镜头', 'SKIP', '--skip-images'); return; }
  const jobs = [];
  for (const s of script.scenes) if (s.video) jobs.push({ label: s.id, file: s.video.file });
  if (!jobs.length) { add('V12', '视频镜头', 'SKIP', 'json 未声明图生视频'); return; }
  const problems = [];
  const dir = path.join(ROOT, ...(script.meta.videoDir || ('assets/video/' + EP)).split('/'));
  for (const j of jobs) {
    const f = path.join(dir, j.file);
    if (!fs.existsSync(f)) { problems.push(j.label + ': 缺文件 ' + j.file); continue; }
    const info = ffprobeJson(f);
    if (!info) { problems.push(j.label + ': ffprobe 失败'); continue; }
    const vs = info.streams.find(st => st.codec_type === 'video');
    if (!vs) { problems.push(j.label + ': 无视频流'); continue; }
    if (vs.width < 1280 || vs.height < 720) problems.push(j.label + ': 分辨率不足 ' + vs.width + 'x' + vs.height);
    const d = info.format ? parseFloat(info.format.duration) : 0;
    if (d < 4) problems.push(j.label + ': 时长 ' + d.toFixed(1) + 's < 4s');
  }
  if (problems.length) add('V12', '视频镜头', 'FAIL', problems.join(' | '));
  else add('V12', '视频镜头', 'PASS', jobs.length + ' 条图生视频全部就绪');
}

// ---------------------------------------------------------------------------
function main() {
  fs.mkdirSync(VERIFY_DIR, { recursive: true });
  const script = v0Schema();
  v1Docs();
  if (script) {
    v2Images(script);
    v3Audio(script);
    v4Duration();
    v5Subs(script);
    v12VideoClips(script);
    if (SKIP_VIDEO) {
      for (const [id, name] of [['V6', '成片基础'], ['V7', '语音边界'], ['V8', '防冻结帧'], ['V9', '抽帧非空白']]) add(id, name, 'SKIP', '--skip-video');
    } else {
      v6Video(script);
      v7Speech(script);
      v8Frozen(script);
      v9Frames(script);
    }
  }
  v10Upstream();
  if (script) v11CharacterColors(script);
  const lines = ['AsCodingComic verify report  ' + new Date().toISOString(), ''];
  let fails = 0;
  for (const r of results) {
    lines.push('[' + r.status + '] ' + r.id + ' ' + r.name + (r.note ? '  -- ' + r.note : ''));
    if (r.status === 'FAIL') fails++;
  }
  const pass = results.filter(r => r.status === 'PASS').length;
  const skip = results.filter(r => r.status === 'SKIP').length;
  lines.push('', 'SUMMARY: ' + pass + ' PASS / ' + fails + ' FAIL / ' + skip + ' SKIP');
  const text = lines.join('\n');
  fs.writeFileSync(path.join(VERIFY_DIR, 'verify-' + EP + '-report.txt'), text);
  console.log(text);
  process.exit(fails ? 1 : 0);
}

main();
