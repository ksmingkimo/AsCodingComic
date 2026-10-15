// copy-product.js — one-way copy product assets from ..\AsCoding into assets\product\ (upstream zero-touch)
// Usage: node scripts/copy-product.js [--ep epXX]
// (node instead of .ps1: source filenames are Chinese; PS 5.1 reads BOM-less files as ANSI,
//  node handles UTF-8 paths directly.)
// Copies: screenshots\界面1-6.png, 主界面1/2.jpg, 流程图\*.png, ui-template.html + css\* + js\*
// Then preprocesses the raw shots declared in comic-script-<ep>.json
// meta.productShots (prep='crop1920') into assets\product\shots\*.png (1920x1080).

'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, '..', 'AsCoding');
const RAW = path.join(ROOT, 'assets', 'product', 'raw');
const SHOTS = path.join(ROOT, 'assets', 'product', 'shots');
const epIdx = process.argv.indexOf('--ep');
const EP = (epIdx !== -1 && process.argv[epIdx + 1]) || process.env.COMIC_EP || 'ep01';

function cp(relSrc, relDst) {
  const s = path.join(SRC, relSrc);
  const d = path.join(RAW, relDst);
  if (!fs.existsSync(s)) { console.log('MISSING upstream: ' + relSrc); return false; }
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.copyFileSync(s, d);
  console.log('+ ' + relDst + ' (' + (fs.statSync(s).size / 1024).toFixed(0) + ' KB)');
  return true;
}

let ok = true;
for (let i = 1; i <= 6; i++) ok = cp('screenshots\\界面' + i + '.png', '界面' + i + '.png') && ok;
ok = cp('主界面1.jpg', '主界面1.jpg') && ok;
ok = cp('主界面2.jpg', '主界面2.jpg') && ok;

// flow diagrams (recursive, one-way)
const flowSrc = path.join(SRC, '流程图');
if (fs.existsSync(flowSrc)) {
  for (const f of fs.readdirSync(flowSrc)) {
    if (f.endsWith('.png')) ok = cp('流程图\\' + f, '流程图\\' + f) && ok;
  }
} else {
  console.log('MISSING upstream dir: 流程图');
  ok = false;
}

// web template (screenshot fallback for product shots)
for (const f of ['ui-template.html']) ok = cp(f, 'web\\' + f) && ok;
for (const d of ['css', 'js']) {
  const srcDir = path.join(SRC, d);
  if (!fs.existsSync(srcDir)) { console.log('MISSING upstream dir: ' + d); ok = false; continue; }
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else ok = cp(path.relative(SRC, p), path.relative(SRC, p)) && ok;
    }
  };
  walk(srcDir);
}

// preprocess the raw shots declared in the episode json (prep='crop1920') to 1920x1080
const scriptPath = path.join(ROOT, 'comic-script-' + EP + '.json');
const shots = [];
if (fs.existsSync(scriptPath)) {
  const meta = JSON.parse(fs.readFileSync(scriptPath, 'utf8')).meta;
  for (const p of (meta.productShots || [])) {
    if (p.prep === 'crop1920') shots.push([String(p.source).replace(/^raw\//, ''), p.out]);
  }
} else {
  console.log('MISSING ' + scriptPath + ' — skipping shot preprocessing');
}
fs.mkdirSync(SHOTS, { recursive: true });
for (const [src, dst] of shots) {
  const s = path.join(RAW, src);
  const d = path.join(SHOTS, dst);
  if (!fs.existsSync(s)) { console.log('MISSING raw: ' + src); ok = false; continue; }
  const r = spawnSync('ffmpeg', ['-y', '-i', s,
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080',
    '-frames:v', '1', d], { encoding: 'utf8' });
  if (r.status !== 0) { console.log('ffmpeg FAILED for ' + src + ': ' + (r.stderr || '').slice(-300)); ok = false; }
  else console.log('+ shots\\' + dst);
}

console.log(ok ? 'copy-product: all OK' : 'copy-product: had missing/failures (see above)');
process.exit(ok ? 0 : 1);
