# dsh-qwen-media

DeepSeek Harness 用户级技能：在**任何项目**的会话中主动调用阿里云百炼 **Token Plan**（`qwen-token-plan-cn`）的图像/视频生成模型，消耗套餐 Credits（`sk-sp-` Key），Key 全程保密。

支持：文生图、图生图/图像编辑、多图融合、框选编辑、连贯组图、文生视频、首帧图生视频、多参考生视频（角色一致性）、音频口型同步、参考文件/网页生视频；尺寸/宽高比求解、官方提示词公式、零成本自检 `--doctor`、用量台账 `--stats`、任务断点续查、后台 job 模式、`/dsh-qwen-media` slash 调用。

## 要求

- DeepSeek Harness（web/desktop 默认挂载 skill 插件即可）
- Node.js ≥ 18（`node --version` 检查）
- 阿里云百炼 Token Plan 订阅（个人版 Lite/Essential/Standard/Pro 均可；模型清单见 `references/models.md`）
- 零 npm 依赖

## 安装（其他电脑同此）

PowerShell：
```powershell
git clone https://github.com/sh-lsy/dsh-qwen-media.git "$HOME\.dsh\skills\dsh-qwen-media"
```
macOS / Linux：
```bash
git clone https://github.com/sh-lsy/dsh-qwen-media.git ~/.dsh/skills/dsh-qwen-media
```
无需重启：技能目录受监视，下一步即出现在会话技能目录。更新：`git -C ~/.dsh/skills/dsh-qwen-media pull`。
（放在 `~/.agents/skills/` 下同样有效。）

## 配置 Key（二选一，切勿贴进聊天）

1. **推荐**：DSH Web UI → 设置 → 模型 → 添加/选择 `qwen-token-plan-cn` → 填入 `sk-sp-` 开头的 Token Plan API Key（保存于 `~/.dsh/.credentials.yaml`，技能自动读取）。
2. 文件：在 `~/.dsh/.env` 加一行 `QWEN_TOKEN_PLAN_CN_API_KEY=sk-sp-…`。

国际站订阅用 `QWEN_TOKEN_PLAN_API_KEY` 并在命令加 `--region intl`。
技能按 DSH 凭据同优先级解析：credentials.yaml → 进程环境 → 项目 `.env` → home `.env`；非 `sk-sp-` 前缀的 Key 会被拒绝（防止误用按量计费 Key 另外扣钱）。

## 使用示例（会话中直接说）

| 你说 | 发生什么 |
|---|---|
| 生成一个图片 | 引导选模型+主题 → 生成 → 内联展示 |
| 生成一张猫的图片 | 只问模型 → 生成展示 |
| 用 wan2.7-image-pro 画 4K 海报，标题"夏日特惠" | 指定模型直接执行（4K 仅文生图） |
| 把这张图背景换成海边（附图） | 图生图编辑，本地图自动 Base64 |
| 四季猫 4 张连环图 | wan2.7 组图模式（n>1 先确认成本） |
| 生成一个视频 | 引导时长/对话意图 → 默认 720P/5s → 后台生成 → 交付 mp4 |
| 把这张图变成视频（附图） | 首帧图生视频 |
| 让图1角色和图2角色对话（附2图） | r2v 多参考 + `[Image n]` 指代 |
| 用这段音频对口型（音频URL） | wan3.0 audio_url |
| /dsh-qwen-media 画一只猫 | slash 直接注入技能 |

成本门槛：视频 >10s 或 1080P、图像 n>1 或 4K 会先向你确认。视频按输出秒数×分辨率计费，失败不计费；Credits 用尽会停止（不转按量）。

## CLI 速览

```bash
node scripts/image.mjs --doctor                 # 零成本自检（node/Key来源/鉴权探针）
node scripts/image.mjs --check                  # 只报 Key 来源，不输出 Key
node scripts/image.mjs --model qwen-image-3.0-pro --prompt "…" --tier 2K --aspect 16:9
node scripts/image.mjs --model wan2.7-image-pro --prompt "…" --image a.png --image b.png --sequential --n 4
node scripts/video.mjs --model wan3.0-video --prompt "…" --resolution 720P --duration 5
node scripts/video.mjs --model happyhorse-1.1-i2v --prompt "…" --first-frame cat.png
node scripts/video.mjs --model happyhorse-1.1-r2v --prompt "[Image 1] 中的角色…" --ref r1.png --ref r2.png
node scripts/video.mjs --task <task_id>         # 断点续查/补下载（24h 内）
node scripts/image.mjs --stats                  # 本地用量台账汇总
```
输出默认 `<当前工作目录>/qwen-media-output/`（含 `ledger.jsonl`）。设了 `HTTP(S)_PROXY` 时脚本走零依赖 CONNECT 隧道。

## 隐私与安全

Key 只存在于脚本进程内存：不打印、不写文件、不进命令行参数；错误信息统一脱敏。输出只写会话工作区。台账为本地估算，计费以百炼控制台为准。

## 故障排查

- `KEY_MISSING`：按上文配置 Key 后重试。
- `WRONG_KEY_TYPE`：用了 `sk-` 按量 Key，换订阅 `sk-sp-` Key。
- 401：Key/端点/地域不配套；403：模型仅团队版；429 insufficient_quota：额度用尽；429 限流：等 60s。
- 审核拦截：按 `references/prompt-guide.md` 改写提示词。
- 详见 `references/models.md` 错误码表。

## Changelog

- 1.0.0：首版。图像三模型/视频四模型全能力、DSH 深度兼容（slash/后台job/附件/present/热更新）、doctor/台账/续查/代理隧道。

## License

见 LICENSE（仓库原有）。
