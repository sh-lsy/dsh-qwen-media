---
name: dsh-qwen-media
description: 调用阿里云百炼 Token Plan（qwen-token-plan-cn，sk-sp- Key，消耗套餐 Credits）生成图像与视频：文生图、图生图/图像编辑、连贯组图、文生视频、首帧图生视频、多参考生视频、音频口型同步、参考文件/网页生视频。用户说"生成图片/画一张/画图/文生图/编辑图片/换背景/组图/连环图/生成视频/文生视频/图生视频/让图动起来/参考生视频/配音/口型"或输入 /dsh-qwen-media 时使用。
whenToUse: 任何项目会话中需要千问/万相/HappyHorse 图像或视频生成时；用户未指定模型先引导选择，指定则直接执行。
metadata:
  version: 1.0.0
  homepage: https://github.com/sh-lsy/dsh-qwen-media
---

# dsh-qwen-media

Token Plan 图像/视频生成。所有调用消耗**套餐 Credits**（`sk-sp-` Key + token-plan 端点）。
禁止改用按量计费 `sk-` Key 或 `dashscope.aliyuncs.com` 的 MCP/通用端点——那会另外扣钱。
脚本零依赖（Node≥18）。`<base>` = 本技能基目录（加载时资源指引给出）。

## 0. 前置检查（会话内首次使用前）

运行 `node "<base>/scripts/image.mjs" --doctor`（零 Credits 鉴权探针）。
- `keyProblem: KEY_MISSING` → 停止并引导：DSH **设置 → 模型 → qwen-token-plan-cn** 填入 sk-sp- Key；或在 `~/.dsh/.env`（Windows `%USERPROFILE%\.dsh\.env`）加一行 `QWEN_TOKEN_PLAN_CN_API_KEY=sk-sp-…`。**绝不要求用户把 Key 贴进聊天**。用户确认配好后重试。
- `WRONG_KEY_TYPE` → 解释 sk- 通用 Key 会按量另计费，引导改订阅 Key。
- `authProbe: KEY_INVALID` → Key 失效/地域不符，引导重新填写。
- `NETWORK` → 检查网络；脚本自动 honoring `HTTP(S)_PROXY`（CONNECT 隧道）。

## 1. 模型选择

**用户指定模型** → 对照 `references/models.md` 清单校验；团队版专属 ID → 说明并给个人版替代。
**未指定** → 用 `ask_user_question` 问一次（推荐项在前；主题缺失时一并收集）：
- 图像：`qwen-image-3.0-pro`（文字渲染/海报/排版/编辑，≤2K，1–3 参考图）｜`wan2.7-image-pro`（摄影级画质，文生图 4K，组图/框选编辑）｜`wan2.7-image`（更快）
- 视频：`wan3.0-video`（≤30s、多镜头、原生音频、文件/网页参考）｜`happyhorse-1.1-t2v`（对话短视频）｜`happyhorse-1.1-i2v`（静图动起来）｜`happyhorse-1.1-r2v`（角色跨镜头一致，1–9 参考图）
意图捷径：文字密集→qwen；4K/组图→wan pro；>15s→wan3.0；口型/配音→wan3.0 `--audio-url`；角色一致→r2v。

## 2. 参数与成本门槛

默认：图像 size 自动、n=1、无水印、prompt_extend 开；视频 720P、5s、16:9、无水印。
**调用前必须 ask_user_question 确认**：视频 duration>10 或 1080P；图像 n>1 或 4K。
复杂提示词 → 读 `references/prompt-guide.md` 加工（多镜头时间戳、声音描述、`[Image n]`/`图 n` 指代）。
尺寸用 `--tier 1K|2K|4K --aspect W:H` 求解器；qwen 最高 2K；wan 4K 仅 pro 文生图非组图。

## 3. 执行

图像（同步，约 1 分钟内）：
`node "<base>/scripts/image.mjs" --model <id> --prompt <text> [--image <路径|URL> …] [--tier 2K --aspect 16:9] [--n N] [--negative <text>] [--seed N] [--sequential] [--thinking] [--bbox JSON] [--no-extend] [--watermark]`
视频或图像 `--async`：**pwsh `run_in_background: true`** 启动，再用 `job_output` 收集；agent 不得 sleep 轮询。
`node "<base>/scripts/video.mjs" --model <id> --prompt <text> [--resolution 720P] [--ratio 16:9] [--duration 5] [--first-frame <路径|URL>] [--ref <路径|URL> …] [--ref-video <URL> …] [--audio-url <URL>] [--media-file <URL>] [--media-link <URL>] [--negative <text>] [--seed N]`
断点续查/补下载：`node "<base>/scripts/video.mjs" --task <task_id>`（24h 有效）。
输入：DSH 附件规范化路径/工作区路径/URL 均可；图像自动 Base64（图像≤10MB、视频帧≤20MB）；**音频/文件/链接仅收公网 URL**。
输出：`<cwd>/qwen-media-output/`（含 ledger.jsonl 台账）。

## 4. 交付

用 `present` 交付 png/mp4；图像用 markdown 内联展示；报告 usage，并可用 `--stats` 汇总本次会话用量（控制台才是计费真源）。

## 5. 错误路由（全表见 references/models.md）

401→Key/地域不配套；403 Unpurchased→团队版模型，给个人版替代；404→ID 不在套餐；
429 `insufficient_quota`→**停止**，不转按量，给重置/用量包/升级选项；429 限流→等 60s 重试一次；
审核类（DataInspectionFailed 等）→按 prompt-guide 改写后重试一次；TIMEOUT→给出 `--task` 续查命令。

## 6. 安全

Key 只存在于脚本进程内存：不打印、不回显、不写入任何文件、不进 argv。输出只写会话工作区。
