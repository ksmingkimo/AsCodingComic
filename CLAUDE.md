# CLAUDE.md — AsCodingComic（SUNLIKE 智能财务分析报表 · 写实宣传视频）

## 一、项目要求（交付目标）

- 一句话定位：为「SUNLIKE 智能财务分析报表」制作真人剧照写实风搞笑宣传视频（修仙宗门天玄宗题材），每集 30–75 秒横屏 1920×1080（2026-08-24 拍板：Veo 场景最少 8s，上限由 60s 放宽至 75s）。
- 交付形态：mp4 成片 + 分镜表 + 角色设定集 + 提示词包 + 全部可再生成中间产物（配音/字幕/时间轴）。
- 核心思路：每集一份 comic-script-epXX.json（单一事实来源）驱动出图参数、配音、字幕、时间轴与 ffmpeg 合成；AI 静图 + Ken Burns 运镜 + Veo 图生视频的动态漫画。
- 验收标准：verify-comic.js 13 项检查全 PASS + 人眼抽检三个关键点。

## 二、铁律：文档同步

- 每次对话交代的任务完成了，就把本次对话更新到 **对话记录.md**（用户与 Claude 的对话台账，任务、拍板、验证结果、踩坑都记）。
- 完整方案见 **方案设计.md**（架构、技术决策、风险清单）；执行进度见 **进度表.md**（决策记录、各阶段任务勾选、待确认问题）。
- 剧情有调整，更新到 剧情脚本.md（用户剧本）→ 再同步 comic-script-epXX.json 和 docs\分镜表-epXX.md。
- **方案有变 → 必须先更新 方案设计.md；进度推进 → 必须同步更新 进度表.md。** 两文件永远反映最新状态，不要只改代码不更新文档。

## 三、铁律：硬约束

1. **上游/原项目零改动**：`..\AsCoding` 只做单向复制（copy-product.js），patch 只打在 `assets\product\` 副本上；V10 断言上游 git 干净。
2. **单一事实来源**：改内容只改 comic-script-epXX.json，下游产物（timeline/SRT/ASS/clips/成片）删掉重跑，绝不手工改两份。多集并行靠 `--ep epXX` 参数（缺省 ep01，或环境变量 COMIC_EP）。
3. **机器可判验证**：本环境无法人眼看图，验证项必须能命令重跑输出 PASS/FAIL（verify-comic.js）。
4. **脚本文件名全 ASCII**：中文只进 json/md/ASS 文本内容（ffmpeg 中文路径 + PS 5.1 编码双重坑）。

## 四、常用命令

```
node scripts\gen-docs.js [--ep epXX]            — 从 comic-script-epXX.json 再生分镜表+提示词包（含豆包提示词全集，改 json 后跑）
node scripts\verify-comic.js [--ep epXX] [--skip-images --skip-video] — 13 项验证，报告写 output\verify\verify-<ep>-report.txt
python scripts\tts.py [--ep epXX] [--force]     — 多角色配音 → assets\audio\<ep>\<sceneId>-<i>.mp3；失败记 output\tts-errors-<ep>.log
node scripts\copy-product.js [--ep epXX]        — 上游单向复制 + meta.productShots 预处理 → assets\product\raw|shots
node scripts\gen-product-shots.js [--ep epXX]   — 产品界面 demo 页 headless 截图（meta.productShots prep='headless' 条目）
node scripts\build-timeline.js [--ep epXX]      — ffprobe 实测时长 → output\timeline-<ep>.json（时间轴唯一来源）
node scripts\make-subs.js [--ep epXX]           — → output\<ep>-dialogue.srt（人校）+ <ep>-subs.ass（烧录）
node scripts\gen-images.js [--ep epXX]          — 场景图/立绘批量出图（Gemini CLI，走 HTTPS_PROXY）+ contact-sheet-<ep>.jpg
node scripts\gen-video.js [--ep epXX] [--only <sceneId>]  — Veo 图生视频（--only 出试片一条）
node scripts\make-bgm.js [--ep epXX]            — meta.bgm 三段拼接 → assets\audio\bgm-<ep>.mp3
node scripts\build-render.js [--ep epXX] [--placeholders] — 合成 → output\<ep>.mp4
bun run src\cli.ts "<prompt>" -a 16:9 -s 2K -d <dir> -o <slug>  — 出图 CLI（tools\nano-banana-2 下，走 HTTPS_PROXY）
```

## 五、目录速览

| 路径 | 作用 |
|---|---|
| 方案设计.md / 进度表.md / 对话记录.md | 方案 / 进度 / 对话（必须同步维护） |
| comic-script-epXX.json | ★ 每集一份单一事实来源，改内容只改它（ep01 为 comic-script-ep01.json） |
| docs\ | 分镜表-epXX.md、角色设定集（人类可读，由 json 导出/引用） |
| prompts\ | 画风锁定词库 + 提示词包 prompts\epXX\（由 json 生成） |
| tools\nano-banana-2\ | 出图 CLI（Gemini API，skill 仓库副本） |
| assets\ | images\epXX（出图落点）/ refs（立绘参考）/ product（上游单向复制+demos）/ audio（配音\epXX+bgm-<ep>）/ sfx（音效） |
| scripts\ | 流水线：tts.py / gen-images.js / gen-video.js / gen-docs.js / gen-product-shots.js / build-timeline.js / make-subs.js / make-bgm.js / build-render.js / verify-comic.js / copy-product.js（均支持 --ep epXX） |
| output\ | 时间轴 / 中间片段 clips\epXX / 字幕 / 成片 epXX.mp4 / 验证报告（均可再生成，按集后缀命名） |

## 六、工程纪律（沿用 AsCodingDemo 经验库）

- PowerShell 5.1：.ps1 纯 ASCII；判 .ps1 成败用 `$?`、原生命令（node/python/ffmpeg）用 `$LASTEXITCODE`。
- edge-tts 走 Python API 传参（规避 Windows argv 编码问题）；已有 mp3 跳过、--force 重合成。
- 出图走 Gemini API 需 `HTTPS_PROXY=127.0.0.1:7897`（命令行默认不吃系统代理）；批量前先探测端点。
- API key 只写 `~\.nano-banana\.env`，不进仓库、不进日志、不进提示词。
- 验证通过后才勾进度表；全程 TodoWrite 维护任务列表。
- 巡检/调试内嵌 JS：多行 `node -e` 一律用 heredoc（`node <<'EOF'`）或 PS here-string（`@'…'@`），或写临时 .js 再跑——裸拼引号会在 Windows 壳层把 `=>`/`>` 解析成重定向，往根目录生成 0 字节代码碎片文件（2026-08-26 查明）。
