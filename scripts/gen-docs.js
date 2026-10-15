// gen-docs.js — regenerate human-readable docs and prompt packs from comic-script-<ep>.json (SSOT)
// Usage: node scripts/gen-docs.js [--ep epXX]
// Outputs: docs/分镜表-<ep>.md, prompts/画风锁定词库.md, prompts/<ep>/*.md
// NEVER hand-edit the generated files; change the episode json and re-run.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const epIdx = process.argv.indexOf('--ep');
const EP = (epIdx !== -1 && process.argv[epIdx + 1]) || process.env.COMIC_EP || 'ep01';
const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'comic-script-' + EP + '.json'), 'utf8'));
const m = script.meta;

function slugOf(file) { return path.basename(file, path.extname(file)); }
function write(rel, content) {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  console.log('+ ' + rel);
}

function roleName(role) {
  const c = script.characters[role];
  return c ? c.name + (c.title ? '（' + c.title + '）' : '') : role;
}

// Full prompt exactly as gen-images.js sends it (styleLock + scene + frozen
// character anchors + composition lock). The prompt pack must show what the
// API actually receives, so user review = shipped prompt.
function fullPromptZh(p, roles) {
  const anchors = (roles || [])
    .map(r => (script.characters[r] && script.characters[r].anchor) ? script.characters[r].anchor.zh : null)
    .filter(Boolean).join(' ');
  return m.styleLock.zh + '。' + p.zh +
    (anchors ? '。' + anchors : '') +
    '。横屏 16:9 构图。画面内不得出现任何文字。';
}
function fullPromptEn(p, roles) {
  const anchors = (roles || [])
    .map(r => (script.characters[r] && script.characters[r].anchor) ? script.characters[r].anchor.en : null)
    .filter(Boolean).join(' ');
  return m.styleLock.en + '. ' + p.en +
    (anchors ? '. ' + anchors : '') +
    '. Horizontal 16:9 composition. Absolutely no text, no letters, no watermark in the image.';
}

function fmtAudio(scene) {
  if (!scene.audio || !scene.audio.length) return '—';
  return scene.audio.map(a => (a.isNarration ? '旁白' : roleName(a.role)) + '：' + a.text).join('<br>');
}

function fmtFlorals(scene) {
  const fs = (scene.florals || []).map(f => f.text);
  if (scene.type === 'montage') {
    for (const ai of scene.image.altImages) if (ai.floral) fs.push(ai.floral.text);
  }
  return fs.length ? fs.join('<br>') : '—';
}

function fmtCamera(c) {
  const names = {
    zoomIn: '推近', zoomOut: '拉远', panUp: '上摇', panDown: '下摇',
    panL: '左摇', panR: '右摇', static: '固定'
  };
  return names[c.mode] + (c.mode === 'static' ? '' : ' ' + c.startZoom.toFixed(2) + '→' + c.endZoom.toFixed(2));
}

function fmtAsset(scene) {
  if (scene.type === 'image') {
    const v = scene.video ? ' 图生视频 ' + scene.video.file : '';
    return scene.image.reuse ? '复用 ' + scene.image.file + v : '出图 ' + scene.image.file + v;
  }
  if (scene.type === 'montage') return '出图 ' + scene.image.altImages.map(a => a.file).join('<br>');
  if (scene.type === 'product') return '产品截图 ' + scene.product.source;
  if (scene.type === 'textcard') return '文字卡（' + (scene.background || '黑底') + '）';
  return '—';
}

// estimated duration heuristic: zh TTS ~4.3 chars/s
function estDur(scene) {
  if (scene.duration.strategy === 'fixed') return scene.duration.holdMs;
  const chars = (scene.audio || []).reduce((n, a) => n + a.text.length, 0);
  const audioMs = Math.round((chars / 4.3) * 1000);
  const fit = m.defaults.leadInMs + audioMs + m.defaults.tailMs;
  return Math.max(fit, scene.duration.holdMs || m.defaults.minHoldMs);
}

// ---------------------------------------------------------------------------
// 1. docs/分镜表-<ep>.md
// ---------------------------------------------------------------------------
(function storyboard() {
  const rows = script.scenes.map((s, i) => {
    const cells = [
      String(i + 1),
      '`' + s.id + '`',
      s.title,
      fmtAsset(s),
      fmtCamera(s.camera),
      fmtAudio(s),
      fmtFlorals(s),
      (estDur(s) / 1000).toFixed(1) + 's',
      (s.transition ? s.transition.name : m.defaults.transition.name) +
        ' ' + ((s.transition || m.defaults.transition).durMs) + 'ms'
    ];
    return '| ' + cells.join(' | ') + ' |';
  });
  const genCount = new Set();
  for (const s of script.scenes) {
    if (s.type === 'image' && s.image.file && !s.image.reuse) genCount.add(s.image.file);
    if (s.type === 'montage') for (const ai of s.image.altImages) genCount.add(ai.file);
  }
  const content = [
    '# 分镜表 — ' + m.title,
    '',
    '> 由 comic-script-' + EP + '.json 生成（`node scripts\\gen-docs.js --ep ' + EP + '` 再生，勿手工编辑）。',
    '',
    '**规格**：' + m.width + '×' + m.height + ' @' + m.fps + 'fps ｜ **出图预算**：场景图 ' + genCount.size + ' 张 + 立绘 ' + script.refs.length + ' 张（≤14）',
    '',
    '| # | 镜头 id | 画面 | 素材 | 运镜 | 台词/旁白 | 花字 | 时长(估) | 转场 |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    '## 备注',
    '',
    ...(m.docsNotes || []).map(n => '- ' + n),
    '- 时长按 4.3 字/秒估算；实际时长由配音 mp3 实测决定（audioFit 自适应），成片目标 30–75s（Veo 场景最少 8s）。',
    '- 台词对白与 剧情脚本.md 逐句一致（V0 机器校验）。',
    ''
  ].join('\n');
  write('docs\\分镜表-' + EP + '.md', content);
})();

// ---------------------------------------------------------------------------
// 2. prompts/画风锁定词库.md
// ---------------------------------------------------------------------------
(function styleLock() {
  const content = [
    '# 画风锁定词库',
    '',
    '> 由 comic-script-' + EP + '.json 的 meta.styleLock / meta.negative 生成，勿手工编辑。所有出图提示词必须原样包含本词库。',
    '',
    '## 风格（中文 · 即梦等）',
    '',
    '```',
    m.styleLock.zh,
    '```',
    '',
    '## 风格（英文 · Midjourney / Gemini）',
    '',
    '```',
    m.styleLock.en,
    '```',
    '',
    '## 通用负向提示词',
    '',
    '中文：`' + m.negative.zh + '`',
    '',
    '英文：`' + m.negative.en + '`',
    '',
    '## 铁律',
    '',
    '1. **画面内不得出现任何文字**（字母、数字、汉字都不行）——字幕花字全由流水线烧录，AI 写字必乱。',
    '2. **横屏 16:9 三重锁**：① 提示词写「横屏 16:9 构图 / horizontal 16:9 composition」② 平台参数选 16:9 ③ 出图后 V2 机器校验宽高比 ±2%。',
    '3. 角色图必须带参考图（即梦参考图功能 / MJ `--cref` / Gemini `-r`），先立绘后场景。',
    '4. **角色造型只在 characters.anchor 定义**：每个出场镜头声明 `roles`，流水线自动把该角色的冻结锚点短语注入提示词（gen-images.js 出图与 gen-docs.js 提示词包同源展开）；场景提示词只写动作/构图/情绪，不重复描述外观。',
    ''
  ].join('\n');
  write('prompts\\画风锁定词库.md', content);
})();

// ---------------------------------------------------------------------------
// 3. prompts/<ep>/00-角色立绘.md  +  per-image prompt pack
// ---------------------------------------------------------------------------
(function promptPack() {
  // 00-角色立绘.md
  const refParts = script.refs.map(r => {
    const c = script.characters[r.char];
    return [
      '## ' + r.file + ' — ' + c.name + '（' + c.title + '）',
      '',
      '**中文提示词（即梦等）**',
      '',
      '```',
      m.styleLock.zh + '。' + r.prompt.zh + '。横屏 16:9 构图。画面内不得出现任何文字。',
      '```',
      '',
      '**英文提示词（Midjourney / Gemini）**',
      '',
      '```',
      m.styleLock.en + '. ' + r.prompt.en + '. Horizontal 16:9 composition. Absolutely no text, no letters, no watermark in the image.',
      '```',
      '',
      '**负向提示词**：' + m.negative.zh + '（中文）/ ' + m.negative.en + '（英文）',
      '',
      '**平台参数**',
      '- 即梦：画面比例 16:9',
      '- Midjourney：`--ar 16:9`',
      '- Gemini CLI（本项目路线 G 自动处理）：`-a 16:9 -s 2K`（需要更高质量加 `-m pro`，成本约 2 倍）',
      '',
      '**保存**：出图后保存为 `assets\\refs\\' + r.file + '`（PNG，≥1600×900，16:9）',
      ''
    ].join('\n');
  });
  const refDoc = [
    '# 00 — 角色立绘（第一批出图）',
    '',
    '> 由 comic-script-' + EP + '.json 的 refs 生成。**先出立绘，交给用户过目确认后再出场景图。**',
    '> 立绘是后续所有场景图的参考图（`-r` / `--cref`），角色一致性全靠它们。',
    '',
    ...refParts,
    '## 出图后流程',
    '',
    '1. 3 张立绘放入 `assets\\refs\\` 后，用户逐张过目确认形象。',
    '2. 确认后跑场景图批量出图（gen-images.js），每张场景图都会带对应立绘做参考。',
    ''
  ].join('\n');
  write('prompts\\' + EP + '\\00-角色立绘.md', refDoc);

  // per-image md
  for (const s of script.scenes) {
    if (s.type === 'image' && s.image.file && !s.image.reuse) {
      const slug = slugOf(s.image.file);
      const refs = s.image.refs || [];
      const refLines = refs.length
        ? refs.map(r => '- `assets\\refs\\' + r + '`（上传为参考图 / MJ `--cref assets\\refs\\' + r + ' --cw 80` / Gemini `-r`）').join('\n')
        : '（无需参考图）';
      const md = [
        '# ' + slug + ' — ' + s.title,
        '',
        '> 由 comic-script-' + EP + '.json 生成，勿手工编辑。场景 id：`' + s.id + '`',
        '',
        '**中文提示词（即梦等）**',
        '',
        '```',
        fullPromptZh(s.image.prompt, s.image.roles),
        '```',
        '',
        '**英文提示词（Midjourney / Gemini）**',
        '',
        '```',
        fullPromptEn(s.image.prompt, s.image.roles),
        '```',
        '',
        '**负向提示词**：' + m.negative.zh + '（中文）/ ' + m.negative.en + '（英文）',
        '',
        '**平台参数**',
        '- 即梦：画面比例 16:9',
        '- Midjourney：`--ar 16:9`',
        '- Gemini CLI（本项目路线 G 自动处理）：`-a 16:9 -s 2K`',
        '',
        '**参考图**',
        refLines,
        '',
        '**保存**：出图后保存为 `' + m.imageDir + '/' + s.image.file + '`（PNG，≥1600×900，16:9）',
        ''
      ];
      if (s.video) {
        md.push(
          '**图生视频动作提示词（Veo · gen-video.js 自动出）**',
          '',
          '```',
          s.video.actionPrompt.en,
          '```',
          '',
          '**视频保存**：`' + (m.videoDir || ('assets/video/' + EP)) + '/' + s.video.file + '`（Veo fast 1080p 8s；生成后 build-timeline / build-render 自动接管，无视频时回退静图运镜）',
          ''
        );
      }
      write('prompts\\' + EP + '\\' + slug + '.md', md.join('\n'));
    } else if (s.type === 'montage') {
      for (const ai of s.image.altImages) {
        const slug = slugOf(ai.file);
        const md = [
          '# ' + slug + ' — ' + s.title + '（蒙太奇子图）',
          '',
          '> 由 comic-script-' + EP + '.json 生成，勿手工编辑。场景 id：`' + s.id + '`。蒙太奇四图为快切镜头，**不出现主角脸部**（降低一致性风险）。',
          '',
          '**中文提示词（即梦等）**',
          '',
          '```',
          fullPromptZh(ai.prompt, ai.roles),
          '```',
          '',
          '**英文提示词（Midjourney / Gemini）**',
          '',
          '```',
          fullPromptEn(ai.prompt, ai.roles),
          '```',
          '',
          '**负向提示词**：' + m.negative.zh + '（中文）/ ' + m.negative.en + '（英文）',
          '',
          '**平台参数**',
          '- 即梦：画面比例 16:9',
          '- Midjourney：`--ar 16:9`',
          '- Gemini CLI（本项目路线 G 自动处理）：`-a 16:9 -s 2K`',
          '',
          '**参考图**：（无需参考图）',
          '',
          '**保存**：出图后保存为 `' + m.imageDir + '/' + ai.file + '`（PNG，≥1600×900，16:9）',
          ''
        ].join('\n');
        write('prompts\\' + EP + '\\' + slug + '.md', md);
      }
    }
  }
})();

// ---------------------------------------------------------------------------
// 4. prompts/<ep>/豆包提示词全集.md — one-file pack for external tools (豆包)
// ---------------------------------------------------------------------------
(function doubaoPack() {
  const L = [];
  L.push('# ' + EP + ' 提示词全集 — 豆包用', '');
  L.push('> 由 comic-script-' + EP + '.json 生成（`node scripts\\gen-docs.js --ep ' + EP + '` 再生，勿手工编辑）。');
  L.push('> **用法**：逐条复制下面各段「提示词」喂给豆包（豆包 App 图片生成）；画幅参数选 16:9；先出「1. 角色立绘」确认形象，再出「2. 场景图」。', '');

  // 0. 全局设定
  L.push('## 0. 全局设定（每张图必须遵守）', '');
  L.push('- 横屏 16:9 构图；出图平台参数也选 16:9。');
  L.push('- 画面内不得出现任何文字、字母、数字、水印、logo。');
  L.push('- 角色造型以各条提示词末尾的锚点描述为准，全程不变。');
  L.push('- **风格锁**（已含在下面每条提示词开头，此处列全文）：');
  L.push('', '```', m.styleLock.zh, '```', '');
  L.push('- **通用负向词**：');
  L.push('', '```', m.negative.zh, '```', '');

  // 1. 角色立绘
  L.push('## 1. 角色立绘（' + script.refs.length + ' 张，先出）', '');
  for (const r of script.refs) {
    const c = script.characters[r.char];
    L.push('### ' + r.file + ' — ' + c.name + '（' + c.title + '）', '');
    L.push('```', m.styleLock.zh + '。' + r.prompt.zh + '。横屏 16:9 构图。画面内不得出现任何文字。', '```', '');
  }

  // 2. 场景图（image 单镜 + montage 子图，按 json 顺序）
  const imgScenes = [];
  for (const s of script.scenes) {
    if (s.type === 'image' && s.image.file && !s.image.reuse) imgScenes.push({ s: s, ai: null });
    if (s.type === 'montage') for (const ai of s.image.altImages) imgScenes.push({ s: s, ai: ai });
  }
  L.push('## 2. 场景图（' + imgScenes.length + ' 张）', '');
  for (const { s, ai } of imgScenes) {
    const file = ai ? ai.file : s.image.file;
    const p = ai ? ai.prompt : s.image.prompt;
    const roles = ai ? ai.roles : s.image.roles;
    const refs = ai ? [] : (s.image.refs || []);
    L.push('### ' + file + ' — ' + s.title + (ai ? '（蒙太奇子图）' : ''), '');
    L.push('```', fullPromptZh(p, roles), '```', '');
    if (ai) L.push('- 备注：蒙太奇快切镜头，**不出现主角脸部**；无需参考图。');
    else if (refs.length) L.push('- 参考图：' + refs.map(x => '`assets\\refs\\' + x + '`').join('、'));
    L.push('- 保存：`' + m.imageDir + file + '`（PNG，≥1600×900，16:9）', '');
  }

  // 3. 附录：图生视频动作提示词（英文 Veo 版；复用切片场景不列）
  L.push('## 3. 附录：图生视频动作提示词（英文 · Veo 版）', '');
  L.push('> 现有成片的动态片段由 Veo 图生视频生成（每集 5 条，8s）。以下为当时实际提交的英文动作提示词。');
  L.push('> 如想让豆包改写成中文视频提示词（即梦 Seedance 用），可把某条连同该场景的中文提示词一起贴给它。', '');
  for (const s of script.scenes) {
    if (s.type === 'image' && !s.image.reuse && s.video && s.video.actionPrompt) {
      L.push('### ' + s.video.file + '（场景 ' + s.id + ' ' + s.title + '）', '');
      L.push('```', s.video.actionPrompt.en, '```', '');
    }
  }
  write('prompts\\' + EP + '\\豆包提示词全集.md', L.join('\n'));
})();

console.log('done. prompt pack + storyboard + 豆包全集 regenerated from comic-script-' + EP + '.json');
