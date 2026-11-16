# 模型与接口参考（官方文档核实，2026-11）

## 端点与鉴权

| 项 | 值 |
|---|---|
| 中国站在订阅 Key | `sk-sp-` 开头；DSH 设置→模型→`qwen-token-plan-cn` 保存于 `~/.dsh/.credentials.yaml` refs |
| 图像（同步/异步） | `POST {host}/api/v1/services/aigc/multimodal-generation/generation` |
| 视频提交 | `POST {host}/api/v1/services/aigc/video-generation/video-synthesis` + 头 `X-DashScope-Async: enable` |
| 任务查询 | `GET {host}/api/v1/tasks/{task_id}`（task_id 与结果 URL 均 24h 有效） |
| host（cn，默认） | `https://token-plan.cn-beijing.maas.aliyuncs.com` |
| host（intl，`--region intl`） | `https://token-plan.ap-southeast-1.maas.aliyuncs.com` |
| 鉴权头 | `Authorization: Bearer <sk-sp- Key>`；Key/端点/地域必须配套 |

Key 解析优先级（镜像 dsh-credentials-local）：`.credentials.yaml` refs → 进程环境 → 项目 `.env` → `~/.dsh/.env`；
名字顺序 `QWEN_TOKEN_PLAN_CN_API_KEY` → `QWEN_TOKEN_PLAN_API_KEY` → `TOKEN_PLAN_API_KEY`。非 `sk-sp-` 前缀拒绝调用。

## 图像模型（个人版 Token Plan）

| 模型 | 能力 | 输出尺寸 | 关键参数（parameters 内） | 输入图 |
|---|---|---|---|---|
| qwen-image-3.0-pro | T2I + I2I/编辑 | 总像素 512\*512–2048\*2048（**最高2K**），比例 1:8–8:1；size `宽*高` 或省略自动 | n 1–6、negative_prompt、seed、prompt_extend(默认true)、prompt_extend_mode(direct/agent)、watermark(默认false) | **1–3 张**；URL/Base64；≤10MB；JPG/PNG/BMP/TIFF/WEBP/GIF；边 1–8000px |
| wan2.7-image-pro | T2I、组图、编辑、框选、多图参考 | 档位 1K/2K(默认)/4K（**4K 仅文生图非组图**）；或 `宽*高` 768²–4096²；有图输入比例随最后一张 | n、watermark(false)、thinking_mode、prompt_extend(true)、enable_sequential、bbox_list；**无 negative_prompt** | URL/Base64；text≤5000字符 |
| wan2.7-image | 同上，更快 | 保守按 ≤2K 处理（官方未单列 4K） | 同 pro | 同 pro |

请求体：`{model, input:{messages:[{role:"user",content:[{text:prompt},{image:url或base64}…]}]}, parameters:{…}}`
响应图像：`output.choices[].message.content[].image`（异步任务亦兼容 `output.results[].url`）；usage：`image_count/width/height`。
DashScope size 分隔符是 `*`（OpenAI 兼容协议才是 `x`）。

## 视频模型（个人版 Token Plan）

| 模型 | 时长 | 分辨率 | ratio | 媒体输入 | 水印默认 | 音频 |
|---|---|---|---|---|---|---|
| wan3.0-video | **2–30s** 整数(默认5) | 480P/720P/1080P | 16:9(默认)/9:16/1:1/4:3/3:4 等，自适应 | media: first_frame(≤1)/reference_image/reference_video(图+视频≤5)/file(docx,ppt,pdf)/link(与file互斥)；`input.audio_url` 口型 | **false** | 原生音频默认开；audio_url(wav/mp3,2–30s,≤15MB,仅URL) |
| happyhorse-1.1-t2v | 3–15s(默认5) | 480P/720P/1080P(默认1080) | 9 种(16:9默认) | 无（纯文本） | **true→脚本改false** | 原生音频（第三方称唇形同步7语言，未核实） |
| happyhorse-1.1-i2v | 3–15s | 同上 | 输出随首帧（ratio 忽略） | media: first_frame **恰1张**；URL/Base64；≥300px；比例1:2.5–2.5:1；≤20MB | true→false | — |
| happyhorse-1.1-r2v | 3–15s | 同上 | 9 种 | media: reference_image **1–9张**；短边≥400px；≤20MB；URL/Base64 | true→false | — |

wan3.0 另有 negative_prompt(≤500字符)、seed、prompt_extend；多镜头靠 prompt 时间戳（**无 shot_type**）。
happyhorse prompt ≤2500 中文字符/5000 非中文；wan prompt 见指南。
请求体：`{model, input:{prompt, media?, audio_url?}, parameters:{resolution, ratio?, duration, watermark, prompt_extend, seed?, negative_prompt?}}`
响应：提交 `output.task_id`；查询 `output.task_status`(PENDING/RUNNING/SUCCEEDED/FAILED/CANCELED/UNKNOWN) → `output.video_url`；usage 含 duration/SR/ratio。
计费：按成功输出秒数×分辨率；**失败不计费**。

## 参考指代约定

- happyhorse-r2v：prompt 用 `[Image 1]…[Image 9]`，顺序=media 数组序。
- wan 参考生视频：中文 `图 1/视频 1`，英文 `Image 1/Video 1`（字母数字间有空格）；图与视频分别计数；仅一个参考时可写"参考图片/参考视频"。

## 错误码对照

| 现象 | 含义 | 处置 |
|---|---|---|
| 401 InvalidApiKey | 未带/错误 Key、误用按量或 Coding Plan Key、订阅过期 | 引导重配 qwen-token-plan-cn |
| 401 Incorrect API key / invalid access token | 误用通用 dashscope Base URL | 换 token-plan 端点 |
| 403 AccessDenied.Unpurchased | 模型仅团队版支持 | 给个人版替代模型 |
| 404 model_not_found | ID 拼错或不在套餐 | 对照上表 |
| 400 参数类 | size/duration/media 组合非法 | 按上表修正 |
| 400 审核类(DataInspectionFailed 等) | 内容审核拦截 | 按 prompt-guide 改写重试一次 |
| 429 insufficient_quota | Credits/用量包用尽 | **停止**；不转按量；等订阅月重置/买用量包/升级 |
| 429 Requests rate limit | 限流（非额度） | 等约60s重试一次，降并发 |
| 502 | 服务端偶发 | 稍后重试 |

## 未核实/排除项

- 第三方宣称 wan3.0 30fps、happyhorse 24fps/7语言唇形同步：官方 API 页未载明，不作承诺、不暴露 fps 参数。
- `happyhorse-video-edit` 不在个人版 Essential 清单 → 排除。
- 本地音频/文档/网页输入官方仅收 URL（Base64 仅图像）→ 引导用户提供公网 URL。

## 官方文档

- Token Plan 概览/接入概览：https://help.aliyun.com/zh/model-studio/token-plan-overview 、…/token-plan-integration-overview
- 图像接入：…/token-plan-image-generation ；视频接入：…/token-plan-video-generation
- 千问图像 API：…/qwen-image-generation-and-editing-api-reference
- 万相2.7图像 API：…/wan-image-generation-and-editing-api-reference
- 万相文生视频指南/API：…/text-to-video-guide 、…/text-to-video-api-reference
- 万相参考生视频 API：…/wan-video-to-video-api-reference
- HappyHorse t2v/i2v/r2v：…/happyhorse-text-to-video-api-reference 、…/happyhorse-image-to-video-api-reference 、…/happyhorse-reference-to-video-api-reference
- 个人版档位与模型清单：…/token-plan-personal-overview ；用量与额度：…/token-plan-usage-quota ；FAQ：…/token-plan-faq
- 提示词指南：…/text-to-video-prompt
