# Qwen media generation

在 DeepSeek Harness 会话里用阿里云百炼 **Token Plan** 订阅生成图像与视频。这是一个技能（skill）包：安装后模型获得 `dsh-qwen-media` 技能，你也可以用 `/dsh-qwen-media` 直接调用。

## 能做什么

- **图像**：文生图、图生图/编辑、多图融合、框选编辑、连贯组图；千问 `qwen-image-3.0-pro`、万相 `wan2.7-image-pro` / `wan2.7-image`。
- **视频**：文生视频、首帧图生视频、多参考生视频（角色一致性）、音频口型同步、参考文件/网页生视频；`wan3.0-video`、`happyhorse-1.1-t2v/i2v/r2v`。
- **选型引导**：未指定模型时先给能力对比（分辨率/横竖屏/时长/音频/参考图/限制），再让你选输出规格；选择即成本确认。
- **保真链路**：参考任务自动关闭提示词改写，附特征锁与画风锁模板；多面板设定表可先转单主体立绘再生成视频。

## 前提

- 阿里云百炼 Token Plan 订阅，API Key 以 **`sk-sp-`** 开头。按量计费的 `sk-` Key 会被拒绝，因为它会另行计费。
- Node.js ≥ 18（脚本零 npm 依赖）。
- 已实测宿主：`dsh 0.2.2-rc.3`。

## 配置 Key（二选一，切勿贴进聊天）

1. DSH Web UI → 设置 → 模型 → `qwen-token-plan-cn` → 填入 `sk-sp-` Key（保存于 `~/.dsh/.credentials.yaml`，技能自动读取）。
2. `~/.dsh/.env` 加一行 `QWEN_TOKEN_PLAN_CN_API_KEY=sk-sp-…`。

国际站订阅用 `QWEN_TOKEN_PLAN_API_KEY`；脚本会据此自动切到 `ap-southeast-1` 端点。

## 用法

会话中直接说需求即可，例如：

- 「生成一张猫的图片」→ 引导选模型与规格 → 生成 → 内联展示
- 「用 wan2.7-image-pro 画 4K 海报，标题"夏日特惠"」
- 「把这张图背景换成海边」（附图）
- 「生成一个视频」「把这张图变成视频」「让图1和图2角色对话」
- `/dsh-qwen-media 画一只猫`

命令行（脚本位于包内 `scripts/`）：

```bash
node scripts/image.mjs --doctor            # 零成本自检：Node、Key 来源、地域、鉴权探针
node scripts/image.mjs --check             # 只报 Key 来源与生效地域
node scripts/image.mjs --model qwen-image-3.0-pro --prompt "…" --tier 2K --aspect 16:9
node scripts/video.mjs --model happyhorse-1.1-r2v --prompt "[Image 1] 中的角色…" --ref r1.png
node scripts/video.mjs --task <task_id>    # 断点续查/补下载（24h）
```

产物写入当前工作目录的 `qwen-media-output/`，含 `ledger.jsonl` 本地用量台账。

## 计费

所有调用消耗 **Token Plan 套餐 Credits**：图像按张×分辨率档位，视频按成功输出秒数×分辨率（失败不计费）。额度用尽会返回 `429 insufficient_quota` 并停止，**不会**自动转按量计费。本地台账只是估算，以百炼控制台用量页为准。

## 安装方式

- **通过插件市场 / `dsh plugin add`**（本包声明了 `dsh.bundle`）：无需克隆，安装后技能自动出现在会话目录。
- **克隆到用户技能目录**：`git clone https://github.com/sh-lsy/dsh-qwen-media.git ~/.dsh/skills/dsh-qwen-media`。这种方式在没有 `dsh.bundle` 支持的环境里同样可用。

两种方式同名，技能注册表按优先级选择其一，不会冲突。

## 限制

- 图像生成不经由模型目录：模型选择器里只有文字/视觉理解模型，图像与视频由此技能调独立接口完成。
- 分辨率与时长受模型约束：千问最高 2K；万相 4K 仅 `wan2.7-image-pro` 文生图；wan3.0 最长 30 秒；HappyHorse 最长 15 秒。
- `wan3.0-video` 的 `first_frame` 只能与 `last_frame` 组合，不能与参考图/文件/链接同用（脚本会提前拒绝非法组合）。
- 音频、文档、网页作为输入时只接受公网 URL；图像支持本地路径与 Base64。
- 第三方文档中未见于官方 API 页的参数（如 HappyHorse 帧率与唇形语言数）不作承诺，也不暴露为参数。

## 安全

API Key 只存在于脚本进程内存：不打印、不写入生成文件、不进入命令行参数；错误信息统一脱敏。技能只写会话工作区的 `qwen-media-output/`。

## 文档

- `references/model-cards.md`：逐模型能力卡（规格、限制、成本）。
- `references/models.md`：端点、参数、错误码对照。
- `references/prompt-guide.md`：提示词公式与参考图保真模板。