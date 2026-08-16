# 格物 gewu-tools v1.0.0 发布说明

> 2026-08-16 ｜ 首个发布 ｜ 许可证 MIT

## 一句话

**格物审视面**：让 DSH 中无视觉能力的模型，通过视觉子代理完成需要「亲眼检查」的任务。

## 版本摘要

- 工具 `gewu_prep`：HTML 按锚点分区逐页渲染 PNG（宿主进程直起 headless Chrome，绕开受限沙箱命名管道限制）+ 自动生成视觉子代理简报契约（纪律声明 / 伪影声明 / 页码归属规则 / 输出要求）
- 工具 `gewu_locate`：把审阅发现中的文字/数字定位回 HTML 源码（页码 section id + 行号 + 脱标签摘录）；count=0 即 OCR 误读，不采信
- 安装双通道：社区通道（本地发布段）+ 独立脚本 `gewu/scripts/install-gewu-plugins.ps1`（Install / Verify / Uninstall / DryRun，幂等）
- 中英双语 README；中文品牌名「格物」取《大学》格物致知

## 模型无关性声明（实测）

在视觉子代理 **mimo-v2.5（稳）** 与 **qwen3.7-plus（洞察强、误报略多）** 上实测验证（24 页售前方案四路对比 + 全量源码真值核验）：**模型档位不决定审阅结果的可信度**——简报契约（上下文）消除无上下文误报，真值核验闭环拦截 OCR 误读与页码偏移。档位差异只体现在审阅风格，不体现在结果对错。

## 快速开始

```powershell
pwsh gewu\scripts\install-gewu-plugins.ps1 -Install   # 幂等；重启 DSH 会话后生效
node gewu\index.js <任意带锚点的 HTML> [outDir]        # 不经 DSH 的冒烟测试
```

## 安装

- **社区通道**：`install-community-plugins.ps1 -Install`（本地发布段，junction 登记 + preset 挂载）
- **独立脚本**：`gewu/scripts/install-gewu-plugins.ps1 -Install`
- 安装后必须重启 DSH 会话（host 插件无热更新）；`-Verify` 应三绿（preset 挂载行 / junction 链 / import 加载）

## 兼容性

- DSH 0.1.0-rc.6（cordis 插件 + defineTool 接口，2026-08-16 最后验证）
- 依赖：仅 peer `@deepseek-ai/dsh-tools`（经工作区 AiBridge 解析）
- 浏览器：自动探测 Chrome/Edge，无需配置；Windows 平台

## Awesome 列表收录描述

> **gewu-tools（格物）** —— Model-agnostic visual-inspection pipeline for text-only DSH agents: `gewu_prep` renders an HTML proposal page-by-page and generates a ready-made vision-subagent briefing contract; dispatch any vision subagent; `gewu_locate` verifies every finding against the HTML source (page id + line number, count=0 means OCR misread). Validated on mimo-v2.5 & qwen3.7-plus: model tier does not determine trustworthiness — context and source verification do. Install: `gewu/scripts/install-gewu-plugins.ps1`. 中文：面向 DSH 纯文本主脑的模型无关视觉审阅流水线（截图 → 视觉子代理简报审阅 → 源码真值核验）。

## 鸣谢

- DSH（DeepSeek Harness）社区：[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) / [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness)
- 命名承兰亭系列规格（品牌 + 职能面）
