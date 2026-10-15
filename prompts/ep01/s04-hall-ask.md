# s04-hall-ask — 宗主拍案质问

> 由 comic-script-ep01.json 生成，勿手工编辑。场景 id：`s04-hall-ask`

**中文提示词（即梦等）**

```
真人影视剧照风格，写实仙侠剧质感，自然皮肤纹理与布料细节，电影级体积光，浅景深，胶片质感。大殿全景：菜鸡坐于高台案后拍案质问，神情激动；锅巴懒散站在堂下，睡眼惺忪，两人一上一下构图。菜鸡（宗主）：60岁男，国字脸、三角眼、浓眉、白发白须，紫色宗主袍绣金色云纹，头戴高冠，手持白色拂尘。不得更换发型胡须、不得加伤疤、不得变年轻、不得更换袍色 锅巴（内门长老）：48岁男，圆脸、双下巴、睡眼惺忪、头发微乱，灰色长老袍，腰间挂锅铲和零食袋。不得画成瘦子、不得精神抖擞、不得更换袍色。横屏 16:9 构图。画面内不得出现任何文字。
```

**英文提示词（Midjourney / Gemini）**

```
Photorealistic cinematic live-action film still, realistic Chinese xianxia TV drama aesthetic, natural skin texture and fabric detail, volumetric lighting, shallow depth of field, 35mm film look. Wide shot of a grand hall: Caiji sitting behind a desk on the platform, slamming the table angrily; below the platform stands Guoba, looking lazy and sleepy; two figures in a top-bottom composition. Caiji the sect master: a 60-year-old man with a square face, fierce triangular eyes, thick eyebrows, white hair and white beard, wearing a purple sect master robe with golden cloud patterns, a tall jade crown, holding a white horsetail whisk. Do not change his hairstyle, beard, crown, or robe color Guoba the inner elder: a 48-year-old plump man with a round face, double chin, sleepy half-closed eyes, slightly messy hair, wearing a plain grey elder robe, a kitchen spatula and a snack pouch hanging at his waist. Do not make him thin or energetic, do not change his robe color. Horizontal 16:9 composition. Absolutely no text, no letters, no watermark in the image.
```

**负向提示词**：低质量、模糊、多余手指、肢体畸形、画面文字、乱码文字、水印、logo、多张脸、动漫、卡通、二次元、赛璐璐平涂、塑料皮肤、CG渲染感（中文）/ low quality, blurry, extra fingers, deformed limbs, text, garbled text, watermark, logo, multiple faces, anime, cartoon, manga, 2D illustration, cel shading, chibi, plastic skin, doll-like, CGI render, video game look（英文）

**平台参数**
- 即梦：画面比例 16:9
- Midjourney：`--ar 16:9`
- Gemini CLI（本项目路线 G 自动处理）：`-a 16:9 -s 2K`

**参考图**
- `assets\refs\ref-caiji.png`（上传为参考图 / MJ `--cref assets\refs\ref-caiji.png --cw 80` / Gemini `-r`）
- `assets\refs\ref-guoba.png`（上传为参考图 / MJ `--cref assets\refs\ref-guoba.png --cw 80` / Gemini `-r`）
- `assets\refs\ref-caiji-tv.png`（上传为参考图 / MJ `--cref assets\refs\ref-caiji-tv.png --cw 80` / Gemini `-r`）
- `assets\refs\ref-guoba-tv.png`（上传为参考图 / MJ `--cref assets\refs\ref-guoba-tv.png --cw 80` / Gemini `-r`）

**保存**：出图后保存为 `assets/images/ep01//s04-hall-ask.png`（PNG，≥1600×900，16:9）

**图生视频动作提示词（Veo · gen-video.js 自动出）**

```
Cinematic live-action shot, 35mm film look: the sect master in purple robes behind a desk slams the table with both hands and stands up angrily, shouting and pointing forward; the lazy elder in gray robes below the platform startles awake, rubs his eyes, then shrugs sheepishly. Camera holds steady on a medium-wide shot with a very gentle dolly-in. Grand ancient Chinese hall, lantern light. Characters must look identical to the reference image, same costumes and faces. No text, no watermark, no subtitles.
```

**视频保存**：`assets/video/ep01//s04-hall-ask.mp4`（Veo fast 1080p 8s；生成后 build-timeline / build-render 自动接管，无视频时回退静图运镜）
