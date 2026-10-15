// gen-images.js — batch image generation via nano-banana-2 CLI (Gemini API, route G)
// Usage: node scripts\gen-images.js [--refs-only] [--scenes-only]
// Default: 3 character refs + all scene images. Idempotent (existing png skipped),
// retries 2x per image, failures collected, exit 1 if anything failed.
// Prompt = styleLock.en + ". " + image.prompt.en + ". Avoid: " + negative.en
// All CLI calls go through HTTPS_PROXY=127.0.0.1:7897 (CLI does not read system proxy).
// Prerequisites: GEMINI_API_KEY in ~\.nano-banana\.env; endpoint reachable through proxy.

'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLI_DIR = path.join(ROOT, 'tools', 'nano-banana-2');
const PROXY = 'http://127.0.0.1:7897';
const epIdx = process.argv.indexOf('--ep');
const EP = (epIdx !== -1 && process.argv[epIdx + 1]) || process.env.COMIC_EP || 'ep01';
const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'comic-script-' + EP + '.json'), 'utf8'));
const m = script.meta;
const IMG_DIR = path.join(ROOT, ...m.imageDir.split('/'));
const REF_DIR = path.join(ROOT, ...m.refDir.split('/'));
const REFS_ONLY = process.argv.includes('--refs-only');
const SCENES_ONLY = process.argv.includes('--scenes-only');

// ---------------------------------------------------------------------------
// prerequisites
// ---------------------------------------------------------------------------
function keyPresent() {
  if (process.env.GEMINI_API_KEY) return true;
  const envFile = path.join(os.homedir(), '.nano-banana', '.env');
  if (!fs.existsSync(envFile)) return false;
  const body = fs.readFileSync(envFile, 'utf8');
  return /GEMINI_API_KEY\s*=\s*\S+/.test(body);
}

function probeEndpoint() {
  // Plain HTTP GET to the proxy in absolute-form (proxy is HTTP, not TLS — https module
  // against it gets ECONNRESET). 404/any status = TLS to Google succeeded through the proxy.
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: 7897, path: 'https://generativelanguage.googleapis.com/', method: 'GET', headers: { Host: 'generativelanguage.googleapis.com' } }, (res) => {
      res.resume();
      resolve({ ok: true, status: res.statusCode });
    });
    req.on('error', (e) => resolve({ ok: false, err: e.code || e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, err: 'timeout' }); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------
function promptFor(p, roles) {
  // Character consistency: every character-bearing prompt gets the FULL frozen
  // anchor phrase per role (characters.<role>.anchor) — appearance lives ONLY
  // in the anchor, scene prompts describe action/composition/emotion.
  const anchors = (roles || [])
    .map(r => (script.characters[r] && script.characters[r].anchor) ? script.characters[r].anchor.en : null)
    .filter(Boolean).join(' ');
  return m.styleLock.en + '. ' + p.en +
    (anchors ? '. ' + anchors : '') +
    '. Avoid: ' + m.negative.en;
}

const jobs = [];
if (!SCENES_ONLY) {
  for (const r of script.refs) {
    jobs.push({
      slug: r.file.replace(/\.png$/i, ''),
      prompt: promptFor(r.prompt),
      refs: [],
      outDir: REF_DIR,
      kind: 'ref'
    });
  }
}
if (!REFS_ONLY) {
  for (const s of script.scenes) {
    if (!s.image) continue;
    if (s.image.reuse) continue;
    if (s.image.altImages) {
      for (const ai of s.image.altImages) {
        jobs.push({
          slug: ai.file.replace(/\.png$/i, ''),
          prompt: promptFor(ai.prompt, ai.roles),
          // CLI joins refs against its own cwd and only treats POSIX-absolute
          // paths as absolute; Windows drive-letter paths get mangled into
          // <cwd>\D:\... → pass refs relative to the CLI directory.
          refs: (ai.refs || []).map(f => path.relative(CLI_DIR, path.join(REF_DIR, f))),
          outDir: IMG_DIR,
          kind: 'scene'
        });
      }
      continue;
    }
    if (!s.image.prompt) continue; // product / textcard
    jobs.push({
      slug: s.image.file.replace(/\.png$/i, ''),
      prompt: promptFor(s.image.prompt, s.image.roles),
      refs: (s.image.refs || []).map(f => path.relative(CLI_DIR, path.join(REF_DIR, f))),
      outDir: IMG_DIR,
      kind: 'scene'
    });
  }
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
// CLI writes <slug>.jpeg regardless of -o extension; canonical form in this
// project is <slug>.png (SSOT + V2 reference it), so jpeg gets transcoded away.
function findOut(job) {
  for (const ext of ['.png', '.jpeg', '.jpg']) {
    const p = path.join(job.outDir, job.slug + ext);
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
  }
  return null;
}

function normalizeToPng(job) {
  const existing = findOut(job);
  if (!existing) return false;
  if (existing.endsWith('.png')) return true;
  const png = path.join(job.outDir, job.slug + '.png');
  const r = spawnSync('ffmpeg', ['-y', '-i', existing, png], { encoding: 'utf8' });
  if (r.status === 0 && fs.existsSync(png)) {
    fs.unlinkSync(existing);
    console.log('  converted ' + path.basename(existing) + ' -> ' + path.basename(png));
    return true;
  }
  console.log('  convert FAILED: ' + (r.stderr || '').slice(-200));
  return false;
}

function runOne(job) {
  if (normalizeToPng(job)) {
    console.log('skip ' + job.slug + ' (exists)');
    return true;
  }
  const args = ['run', 'src/cli.ts', job.prompt, '-a', '16:9', '-s', '2K', '-d', job.outDir, '-o', job.slug];
  for (const r of job.refs) args.push('-r', r);
  const env = Object.assign({}, process.env, { HTTPS_PROXY: PROXY, HTTP_PROXY: PROXY });
  console.log('gen ' + job.slug + (job.refs.length ? ' (refs: ' + job.refs.map(f => path.basename(f)).join(',') + ')' : ''));
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) console.log('  retry ' + attempt + '...');
    const r = spawnSync('bun', args, { cwd: CLI_DIR, env, encoding: 'utf8', timeout: 300000 });
    if (r.status === 0 && normalizeToPng(job)) return true;
    last = (r.stderr || r.stdout || '').trim().split('\n').pop();
  }
  console.log('  FAILED: ' + (last || 'no output'));
  return false;
}

// Contact sheet: tile refs + generated images into ONE grid for the human
// consistency review gate (output/contact-sheet.jpg).
function contactSheet() {
  const files = script.refs.map(r => path.join(REF_DIR, r.file)).filter(f => fs.existsSync(f))
    .concat(jobs.filter(j => j.kind === 'scene').map(j => findOut(j)).filter(Boolean));
  if (files.length < 2) return;
  const ccDir = path.join(ROOT, 'output', 'verify', 'cc-' + EP);
  fs.rmSync(ccDir, { recursive: true, force: true });
  fs.mkdirSync(ccDir, { recursive: true });
  const cells = 16;
  files.forEach((f, i) => fs.copyFileSync(f, path.join(ccDir, 'cc-' + String(i).padStart(2, '0') + '.png')));
  for (let i = files.length; i < cells; i++) {
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x111111:s=640x360', '-frames:v', '1', path.join(ccDir, 'cc-' + String(i).padStart(2, '0') + '.png')]);
    if (r.status !== 0) return;
  }
  // This ffmpeg build has no glob support: pass the 16 cells as explicit inputs,
  // normalize each to 480x270 rgb24, concat into one stream, tile 4x4.
  const args = ['-y', '-loglevel', 'error'];
  const chains = [];
  for (let i = 0; i < cells; i++) {
    args.push('-i', path.join(ccDir, 'cc-' + String(i).padStart(2, '0') + '.png'));
    chains.push('[' + i + ':v]scale=480:270,format=rgb24,setsar=1[f' + i + ']');
  }
  const out = path.join(ROOT, 'output', 'contact-sheet-' + EP + '.jpg');
  const mapIn = chains.map((_, i) => '[f' + i + ']').join('');
  const r = spawnSync('ffmpeg', args.concat([
    '-filter_complex', chains.join(';') + ';' + mapIn + 'concat=n=16:v=1,tile=4x4:padding=8:color=0x111111[out]',
    '-map', '[out]', '-frames:v', '1', out]));
  if (r.status === 0) console.log('contact sheet: output/contact-sheet-' + EP + '.jpg (' + files.length + ' images)');
  else console.log('contact sheet FAILED: ' + (r.stderr || '').slice(-200));
}

async function main() {
  console.log('jobs: ' + jobs.length + ' (' + jobs.filter(j => j.kind === 'ref').length + ' refs, ' + jobs.filter(j => j.kind === 'scene').length + ' scenes)');
  if (!jobs.length) { console.log('nothing to do'); return; }

  if (!keyPresent()) {
    console.log('ABORT: GEMINI_API_KEY missing. Fill C:\\Users\\<you>\\.nano-banana\\.env then rerun.');
    process.exit(1);
  }
  const probe = await probeEndpoint();
  if (!probe.ok) {
    console.log('ABORT: endpoint unreachable through 127.0.0.1:7897 (' + probe.err + '). Check proxy node, then rerun.');
    process.exit(1);
  }
  console.log('endpoint probe OK (HTTP ' + probe.status + ' = TLS handshake fine)');

  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(REF_DIR, { recursive: true });
  const failed = [];
  for (const job of jobs) if (!runOne(job)) failed.push(job.slug);
  contactSheet();

  const costsFile = path.join(os.homedir(), '.nano-banana', 'costs.json');
  if (fs.existsSync(costsFile)) console.log('cost tracker: ' + fs.readFileSync(costsFile, 'utf8'));

  if (failed.length) {
    console.log('FAILED (' + failed.length + '): ' + failed.join(', '));
    process.exit(1);
  }
  console.log('all ' + jobs.length + ' images done');
}

if (process.argv[2] === '--sheet-only') { contactSheet(); process.exit(0); }
main();
