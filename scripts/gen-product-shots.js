// gen-product-shots.js — Chrome headless screenshots of pipeline-made demo pages
// Usage: node scripts/gen-product-shots.js [--ep epXX] [--force]
// Reads comic-script-<ep>.json meta.productShots entries with prep='headless':
//   source: demos/<page>.html  (relative to assets/product/)
//   out:    <name>.png         (written to assets/product/shots/)
// Demo pages link the copied raw\css\dashboard.css so shots match the real
// product look. Zero JS in the pages — no CDN, renders offline.
// Browser chain: CHROME_PATH env > Program Files Google Chrome > (x86) Chrome >
// (x86) Edge > Edge. Retries old --headless flag if --headless=new fails.
// Idempotent: existing shot skipped unless --force. Output validated with
// ffprobe; non-1080p results scaled/cropped via ffmpeg as fallback.
// Final fallback per plan: revert to ep01 method (raw screenshots + floral
// narration) — shots are only declared for scenes where data pages exist.

'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const epIdx = process.argv.indexOf('--ep');
const EP = (epIdx !== -1 && process.argv[epIdx + 1]) || process.env.COMIC_EP || 'ep01';
const FORCE = process.argv.includes('--force');

const DEMO_DIR = path.join(ROOT, 'assets', 'product');
const SHOTS_DIR = path.join(ROOT, 'assets', 'product', 'shots');

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function probeInfo(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', file], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    return j.streams.find(s => s.codec_type === 'video') || null;
  } catch (e) { return null; }
}

// non-1080p fallback: scale/crop to exactly 1920x1080
function fixTo1080(out) {
  const tmp = out + '.fix.png';
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', out,
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080',
    '-frames:v', '1', tmp], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(tmp)) {
    console.log('  ffmpeg fallback FAILED: ' + (r.stderr || '').slice(-200));
    return false;
  }
  fs.rmSync(out, { force: true });
  fs.renameSync(tmp, out);
  return true;
}

function shotOne(entry, browser) {
  const html = path.join(DEMO_DIR, entry.source);
  const out = path.join(SHOTS_DIR, entry.out);
  if (fs.existsSync(out) && !FORCE) { console.log('skip ' + entry.out + ' (exists)'); return true; }
  if (!fs.existsSync(html)) { console.log('MISSING demo page: ' + entry.source); return false; }
  const url = 'file:///' + html.replace(/\\/g, '/');
  const userData = path.join(os.tmpdir(), 'comic-chrome-' + path.basename(entry.out, '.png'));
  const common = ['--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1920,1080', '--virtual-time-budget=1500', '--user-data-dir=' + userData,
    '--screenshot=' + out, url];
  let r = spawnSync(browser, ['--headless=new', ...common], { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0 || !fs.existsSync(out)) {
    console.log('  --headless=new failed, retrying --headless...');
    r = spawnSync(browser, ['--headless', ...common], { encoding: 'utf8', timeout: 60000 });
  }
  let ok = r.status === 0 && fs.existsSync(out);
  if (ok) {
    const vs = probeInfo(out);
    if (!vs) { console.log('  ffprobe FAILED for ' + entry.out); ok = false; }
    else if (vs.width === 1920 && vs.height === 1080) {
      console.log('+ shots/' + entry.out + ' (1920x1080)');
    } else {
      console.log('  ' + entry.out + ' is ' + vs.width + 'x' + vs.height + ', applying 1080p fallback');
      ok = fixTo1080(out) && !!probeInfo(out);
      if (ok) console.log('+ shots/' + entry.out + ' (fixed to 1920x1080)');
    }
  }
  fs.rmSync(userData, { recursive: true, force: true });
  if (!ok) console.log('  FAILED: ' + entry.out + ' — ' + (r.stderr || '').split('\n').slice(-3).join(' ').slice(-300));
  return ok;
}

function main() {
  const scriptPath = path.join(ROOT, 'comic-script-' + EP + '.json');
  if (!fs.existsSync(scriptPath)) { console.log('MISSING ' + scriptPath); process.exit(1); }
  const meta = JSON.parse(fs.readFileSync(scriptPath, 'utf8')).meta;
  const shots = (meta.productShots || []).filter(p => p.prep === 'headless');
  if (!shots.length) { console.log('no headless shots declared for ' + EP); return; }

  const browser = findBrowser();
  if (!browser) {
    console.log('ABORT: no Chrome/Edge found (set CHROME_PATH). Fallback: revert to ep01 method.');
    process.exit(1);
  }
  console.log('browser: ' + browser);

  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  let ok = true;
  for (const s of shots) if (!shotOne(s, browser)) ok = false;
  console.log(ok ? 'gen-product-shots: all OK' : 'gen-product-shots: had failures (see above)');
  process.exit(ok ? 0 : 1);
}

main();
