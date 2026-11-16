---
name: dsh-qwen-media
description: 调用阿里云百炼 Token Plan（qwen-token-plan-cn，sk-sp- Key，消耗套餐 Credits）生成图像与视频：文生图、图生图/图像编辑、连贯组图、文生视频、首帧图生视频、多参考生视频、音频口型同步、参考文件/网页生视频。用户说"生成图片/画一张/画图/文生图/编辑图片/换背景/组图/连环图/生成视频/文生视频/图生视频/让图动起来/参考生视频/配音/口型"或输入 /dsh-qwen-media 时使用。
whenToUse: 任何项目会话中需要千问/万相/HappyHorse 图像或视频生成时；未指定模型先给能力对比引导选择，再让用户知情选择输出规格。
metadata:
  version: 1.1.0
  homepage: https://github.com/sh-lsy/dsh-qwen-media
---

# dsh-qwen-media

Token Plan 图像/视频生成。所有调用消耗**套餐 Credits**（`sk-sp-` Key + token-plan 端点）。
禁止改用按量计费 `sk-` Key 或 `dashscope.aliyuncs.com` 的 MCP/通用端点——那会另外扣钱。
脚本零依赖（Node≥18）。`<base>` = 本技能基目录。**选型必读 `references/model-cards.md`**（能力卡：分辨率/横竖屏/时长/音频/参考/限制）。

## 0. 前置检查（会话内首次使用前）

运行 `node "<base>/scripts/image.mjs" --doctor`（零 Credits 鉴权探针）。
- `KEY_MISSING` → 停止并引导：DSH **设置 → 模型 → qwen-token-plan-cn** 填 sk-sp- Key；或 `~/.dsh/.env` 加 `QWEN_TOKEN_PLAN_CN_API_KEY=sk-sp-…`。**绝不收 Key 进聊天**。配好后重试。
- `WRONG_KEY_TYPE` → 解释 sk- 会按量另计费，引导改订阅 Key。`KEY_INVALID` → 引导重填。`NETWORK` → 脚本自动 honoring `HTTP(S)_PROXY`。

## 1. 模型选择（两段式知情提问）

**用户指定模型** → 对照 model-cards 校验；团队版专属 → 说明+个人版替代；原话已含规格 → 跳过 Q2 对应项。
**未指定** → 先读 model-cards，然后：

**Q1（ask_user_question）**：question 文本内嵌能力对比表（模型｜输出规格｜横竖屏｜时长｜音频｜参考图｜强项），option 描述必须含"规格+强项+限制"完整一句，推荐项在前标 (Recommended)。示例描述：
- 图像：`qwen-image-3.0-pro：最高2K、横竖屏自由、1–3参考图、可编辑、文字/海报渲染最强；无4K`｜`wan2.7-image-pro：文生图4K/编辑组图2K、方形或随参考图、框选编辑、摄影级画质；无negative_prompt`｜`wan2.7-image：同pro更快更省、≤2K`
- 视频：`wan3.0-video：480/720/1080P、横竖屏5比例、2–30s、原生音频+口型、参考图≤5/文件/网页、多镜头旗舰`｜`happyhorse-1.1-r2v：480–1080P、9比例、3–15s、1–9参考图角色高一致`｜`happyhorse-1.1-i2v：比例随首帧、3–15s、单静图动画化`｜`happyhorse-1.1-t2v：9比例含21:9、3–15s、对话表演短视频、无参考`
意图捷径：文字密集→qwen；4K/组图→wan pro；>15s/多镜头/口型→wan3.0；角色一致→r2v；静图动画→i2v；**设定表/多面板参考→先立绘再视频（见§2）**。

**Q2（Q1  answered 后，模型感知规格；选择即成本确认）**：
- 视频：① 画幅+分辨率：横屏720P(推荐)/横屏1080P/竖屏720P/竖屏1080P/方形1:1·720P（描述带成本：1080P≈720P×2.25）；② 时长：5s(推荐)/10s/15s/30s(仅wan3.0)。**选中 >10s 或 1080P 即视为确认，不再重复问**。有首帧时说明"比例将跟随首帧"。
- 图像：① tier：1K/2K(推荐)/4K(仅wan-pro纯文生图)；② 画幅：1:1(推荐)/16:9横/9:16竖/3:4竖/4:3横；③ 张数：1(推荐)/2/4/6(仅qwen)。4K 或 n>1 选中即确认。
- 未走 Q2 时的兜底门槛：视频>10s/1080P、图像n>1/4K 仍须 ask 确认。

## 2. 提示词与参考保真

复杂提示词 → 读 `references/prompt-guide.md`（公式+**参考保真章节**）。
**参考任务（有 --ref/--first-frame/--image）默认规则**：
- **特征锁**：逐条枚举判别特征（品种/瞳色/斑纹位置/毛色分布/尾渐变/鼻色/毛量）+“保持与参考图完全一致，不得改变品种/瞳色/斑纹位置”。
- **画风锁**：识别参考图画风并显式锁定（插画/写实/3D），除非用户另指定。
- **自动 `--no-extend`**（脚本在有参考时默认 prompt_extend=false；显式 `--extend` 可开）。
- wan3.0 加 `--negative "毛色改变、斑纹位置错误、瞳色改变、画风突变、多余肢体"`。
- **设定表/多面板参考 → 默认两步**：① qwen-image-3.0-pro I2I 重绘单主体立绘（正面全身、纯色背景、保持斑纹瞳色画风、无文字无面板）；② 立绘作 r2v/i2v 参考。单主体干净图→直接参考。
- 高保真双锁（wan3.0）：`--first-frame 立绘 --ref 立绘`。
- 指代：happyhorse `[Image n]`；wan `图 n`/`Image n`。

## 3. 执行

图像（同步约1分钟）：`node "<base>/scripts/image.mjs" --model <id> --prompt <text> [--image <路径|URL> …] [--tier 2K --aspect 16:9] [--n N] [--negative …] [--seed N] [--sequential] [--thinking] [--bbox JSON] [--no-extend|--extend] [--watermark]`
视频/图像--async：**pwsh run_in_background** + `job_output` 收集；不得 sleep 轮询。
`node "<base>/scripts/video.mjs" --model <id> --prompt <text> [--resolution 720P] [--ratio 16:9] [--duration 5] [--first-frame …] [--ref …] [--ref-video URL …] [--audio-url URL] [--media-file URL] [--media-link URL] [--negative …] [--seed N] [--no-extend|--extend]`
续查/补下载：`node "<base>/scripts/video.mjs" --task <id>`（24h）。
输入：DSH 附件路径(无扩展名亦可,魔数嗅探)/工作区路径/URL；图像自动 Base64(图≤10MB、视频帧≤20MB)；音频/文件/链接仅 URL。
输出：`<cwd>/qwen-media-output/`（含 ledger.jsonl）。

## 4. 交付

`present` 交付 png/mp4；图像内联展示；报告 usage + `--stats` 汇总（控制台为计费真源）。

## 5. 错误路由（全表 references/models.md）

401→Key/地域不配套；403→团队版模型给替代；404→ID 不在套餐；429 insufficient_quota→**停止**不转按量；429 限流→等60s重试一次；审核类→按 prompt-guide 改写重试一次；TIMEOUT→给 `--task` 续查命令。

## 6. 安全

Key 仅脚本进程内存：不打印/不回显/不写文件/不进 argv。输出只写会话工作区。
