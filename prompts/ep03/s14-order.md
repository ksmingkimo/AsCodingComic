# s14-order — 宗主立新规

> 由 comic-script-ep03.json 生成，勿手工编辑。场景 id：`s14-order`

**中文提示词（即梦等）**

```
真人影视剧照风格，写实仙侠剧质感，自然皮肤纹理与布料细节，电影级体积光，浅景深，胶片质感。菜鸡立于高台之上拍案下令，神情威严，一手指向前方，大殿气势庄重，堂下弟子俯首听令，中景。菜鸡（宗主）：60岁男，国字脸、三角眼、浓眉、白发白须，紫色宗主袍绣金色云纹，头戴高冠，手持白色拂尘。不得更换发型胡须、不得加伤疤、不得变年轻、不得更换袍色。横屏 16:9 构图。画面内不得出现任何文字。
```

**英文提示词（Midjourney / Gemini）**

```
Photorealistic cinematic live-action film still, realistic Chinese xianxia TV drama aesthetic, natural skin texture and fabric detail, volumetric lighting, shallow depth of field, 35mm film look. Caiji the sect master standing on the platform slamming the desk and giving a decisive order, stern and dignified, pointing forward with one hand, the grand hall imposing and solemn, disciples below bowing in obedience, medium shot. Caiji the sect master: a 60-year-old man with a square face, fierce triangular eyes, thick eyebrows, white hair and white beard, wearing a purple sect master robe with golden cloud patterns, a tall jade crown, holding a white horsetail whisk. Do not change his hairstyle, beard, crown, or robe color. Horizontal 16:9 composition. Absolutely no text, no letters, no watermark in the image.
```

**负向提示词**：低质量、模糊、多余手指、肢体畸形、画面文字、乱码文字、水印、logo、多张脸、动漫、卡通、二次元、赛璐璐平涂、塑料皮肤、CG渲染感（中文）/ low quality, blurry, extra fingers, deformed limbs, text, garbled text, watermark, logo, multiple faces, anime, cartoon, manga, 2D illustration, cel shading, chibi, plastic skin, doll-like, CGI render, video game look（英文）

**平台参数**
- 即梦：画面比例 16:9
- Midjourney：`--ar 16:9`
- Gemini CLI（本项目路线 G 自动处理）：`-a 16:9 -s 2K`

**参考图**
- `assets\refs\ref-caiji.png`（上传为参考图 / MJ `--cref assets\refs\ref-caiji.png --cw 80` / Gemini `-r`）
- `assets\refs\ref-caiji-tv.png`（上传为参考图 / MJ `--cref assets\refs\ref-caiji-tv.png --cw 80` / Gemini `-r`）

**保存**：出图后保存为 `assets/images/ep03//s14-order.png`（PNG，≥1600×900，16:9）

**图生视频动作提示词（Veo · gen-video.js 自动出）**

```
Cinematic live-action shot, 35mm film look: the sect master in purple robes standing on the platform, slamming the desk and giving a decisive order, stern and dignified, pointing forward emphatically, then raising his fist. Medium shot, grand ancient hall, disciples below bowing. Steady camera with a slow zoom-out. Character must look identical to the reference image, same costume and face. No text, no watermark, no subtitles.
```

**视频保存**：`assets/video/ep03//s14-order.mp4`（Veo fast 1080p 8s；生成后 build-timeline / build-render 自动接管，无视频时回退静图运镜）
