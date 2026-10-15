// gen-video.js — batch Veo image-to-video generation for AsCodingComic
// Usage: node scripts/gen-video.js [--ep epXX] [--force] [--only <sceneId>]
// Reads comic-script-<ep>.json; for every scene with a `video` declaration whose
// clip file is missing (assets/video/<ep>/), submits the source image to the
// Veo API (meta.veo.model :predictLongRunning), polls the operation every
// 12s (max 8min), downloads the mp4. Idempotent: existing clips are skipped
// unless --force. --only <sceneId> restricts to one scene (human-review pilot clip).
// Failures retried 2x and logged to output/veo-errors-<ep>.log.
// Cost tracked from meta.veo.ratePerSecond (fast 1080p 8s ≈ $0.96/clip).
// API key is read from ~\.nano-banana\.env only — never logged or embedded.

'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const epIdx = process.argv.indexOf('--ep');
const EP = (epIdx !== -1 && process.argv[epIdx + 1]) || process.env.COMIC_EP || 'ep01';
const SCRIPT = path.join(ROOT, 'comic-script-' + EP + '.json');
const WORK = path.join(ROOT, 'output', 'veo-work', EP);
const ERROR_LOG = path.join(ROOT, 'output', 'veo-errors-' + EP + '.log');
const FORCE = process.argv.includes('--force');
const PROXY = 'http://127.0.0.1:7897';
const API = 'https://generativelanguage.googleapis.com/v1beta';

function readKey() {
  const env = path.join(os.homedir(), '.nano-banana', '.env');
  const m = fs.readFileSync(env, 'utf8').match(/GEMINI_API_KEY\s*=\s*(\S+)/);
  if (!m) { console.log('GEMINI_API_KEY not found in ' + env); process.exit(1); }
  return m[1];
}
const KEY = readKey();

function sh(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function curlReq(args, url) {
  const r = sh('curl', ['-s', '-m', '300', '-x', PROXY, '-H', 'x-goog-api-key: ' + KEY, ...args, url]);
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch (e) { return null; }
}

function genOne(scene, veo) {
  const outFile = path.join(ROOT, ...(script.meta.videoDir || ('assets/video/' + EP)).split('/'), scene.video.file);
  const srcPng = path.join(ROOT, ...script.meta.imageDir.split('/'), scene.video.sourceImage);
  const workJpg = path.join(WORK, scene.id + '-src.jpg');
  const reqJson = path.join(WORK, scene.id + '-req.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });

  const r0 = sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', srcPng, '-vf', 'scale=1920:1080', '-q:v', '2', workJpg]);
  if (r0.status !== 0 || !fs.existsSync(srcPng)) return '源图缩放失败 ' + scene.video.sourceImage;

  const b64 = fs.readFileSync(workJpg).toString('base64');
  const body = JSON.stringify({
    instances: [{
      prompt: scene.video.actionPrompt.en,
      image: { bytesBase64Encoded: b64, mimeType: 'image/jpeg' }
    }],
    parameters: {
      aspectRatio: veo.aspectRatio, resolution: veo.resolution,
      negativePrompt: veo.negativePrompt, personGeneration: 'allow_adult', sampleCount: 1
    }
  });
  fs.writeFileSync(reqJson, body);

  const sub = curlReq(['-H', 'Content-Type: application/json', '-X', 'POST', '--data-binary', '@' + reqJson],
    API + '/models/' + veo.model + ':predictLongRunning');
  if (!sub || !sub.name) return '提交失败: ' + JSON.stringify(sub).slice(0, 300);

  for (let i = 1; i <= 40; i++) {
    sleepMs(12000);
    const st = curlReq([], API + '/' + sub.name);
    if (!st) return '轮询失败（第' + i + '次）';
    if (st.done) {
      const uri = st.response && st.response.generateVideoResponse
        && st.response.generateVideoResponse.generatedSamples
        && st.response.generateVideoResponse.generatedSamples[0].video.uri;
      if (!uri) return '完成但无下载地址: ' + JSON.stringify(st).slice(0, 300);
      const dl = sh('curl', ['-s', '-L', '-m', '300', '-x', PROXY, '-H', 'x-goog-api-key: ' + KEY, '-o', outFile, uri]);
      if (dl.status !== 0 || !fs.existsSync(outFile) || fs.statSync(outFile).size < 100000)
        return '下载失败 bytes=' + (fs.existsSync(outFile) ? fs.statSync(outFile).size : 0);
      const p = sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outFile]);
      const dur = parseFloat((p.stdout || '').trim());
      if (!(dur >= 4)) { fs.unlinkSync(outFile); return '成片时长异常 ' + dur; }
      return null; // success
    }
  }
  return '轮询超时（8 分钟）';
}

const script = JSON.parse(fs.readFileSync(SCRIPT, 'utf8'));
const veo = script.meta.veo || {
  model: 'veo-3.1-fast-generate-preview', resolution: '1080p', durationSeconds: 8,
  aspectRatio: '16:9', negativePrompt: '', ratePerSecond: 0.12
};
const videoDir = path.join(ROOT, ...(script.meta.videoDir || ('assets/video/' + EP)).split('/'));
// dedupe: scenes reusing the same clip (slice reuse) must not trigger a second generation
const seen = new Set();
const jobs = script.scenes.filter(s => s.video).filter(s => {
  if (seen.has(s.video.file)) return false;
  seen.add(s.video.file);
  return true;
}).map(s => {
  const out = path.join(videoDir, s.video.file);
  return { scene: s, out, pending: FORCE || !fs.existsSync(out) };
});
// --only <sceneId>: pilot clip for the human three-check gate before batch
const onlyIdx = process.argv.indexOf('--only');
if (onlyIdx !== -1 && process.argv[onlyIdx + 1]) {
  const only = process.argv[onlyIdx + 1];
  const idx = jobs.findIndex(j => j.scene.id === only);
  if (idx === -1) { console.log('--only: no video scene ' + only); process.exit(1); }
  jobs.splice(0, jobs.length, jobs[idx]);
  console.log('--only: restricted to ' + only);
}
console.log('jobs: ' + jobs.length + ' declared, ' + jobs.filter(j => j.pending).length + ' pending');

const failures = [];
let cost = 0;
for (const j of jobs) {
  if (!j.pending) { console.log('skip ' + j.scene.video.file + ' (exists)'); continue; }
  let err = genOne(j.scene, veo);
  for (let attempt = 2; attempt <= 3 && err; attempt++) {
    console.log('retry ' + j.scene.id + ' (attempt ' + attempt + ') ...');
    err = genOne(j.scene, veo);
  }
  if (err) {
    failures.push(j.scene.id + ': ' + err);
    console.log('FAILED ' + j.scene.id + ': ' + err);
  } else {
    cost += veo.ratePerSecond * veo.durationSeconds;
    console.log('OK ' + j.scene.id + '  (cost so far $' + cost.toFixed(2) + ')');
  }
}

fs.writeFileSync(ERROR_LOG, failures.join('\n'), 'utf8');
console.log('gen-video done: ' + (jobs.length - failures.length) + '/' + jobs.length + ' ok, est cost $' + cost.toFixed(2));
if (failures.length) { console.log(failures.length + ' failed, see ' + ERROR_LOG); process.exit(1); }
