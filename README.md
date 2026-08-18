# 格物 gewu-tools

[![npm](https://img.shields.io/npm/v/gewu-tools.svg)](https://www.npmjs.com/package/gewu-tools)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/nyantused-cpun/gewu-tools.svg)](https://github.com/nyantused-cpun/gewu-tools/releases)

**格物审视面**：让 DSH 中无视觉能力的模型，通过视觉子代理完成需要「亲眼检查」的任务。

> 格物：《大学》「格物致知，考察事物而后知」——先把东西看仔细，再下结论。
> English: [README.en.md](README.en.md)

## 快速安装（npm）

```powershell
npm i gewu-tools
pwsh node_modules\gewu-tools\scripts\install-gewu-plugins.ps1 -Install   # 挂载进 DSH（幂等）
# 或使用 DSH 插件管理器直接安装（需要 dsh.bundle manifest；安装后同样重启会话）
dsh plugin add gewu-tools
# 重启 DSH 会话后 gewu_prep / gewu_locate 即出现在工具目录；-Verify 四绿即安装成功
# 可选：注入自定义规范 preset（默认 community 零注入；也可用环境变量 GEWU_BRIEF_PRESET 指定）
pwsh gewu\scripts\install-gewu-plugins.ps1 -Install -Preset <preset文件路径>
```

## 它解决什么问题

DSH 的会话主脑通常是**纯文本模型**——它读不了渲染出来的页面，自然回答不了「这页方案好不好看、挤不挤、图连对没有」。视觉子代理（如 `subagent_vision`，mimo-v2.5 等）看得见，但有两个短板：

1. **没有会话上下文**：它不知道客户铁律、业务标记语义（比如 ⭐ 是「核心能力」不是装饰 emoji），会把有意设计误报成缺陷；
2. **会看错**：OCR 级误读（字认错）、页码归属被截图边界带偏。

格物把 2026-08-16 在 24 页售前方案上实测收敛的**三步流水线**做成两个工具：

```
① gewu_prep    截图 + 简报：HTML 逐页渲染 PNG，并生成一份完整的视觉子代理简报契约
               （纪律声明 / 伪影声明 / 页码归属规则 / 输出要求）
② 视觉子代理   派发：把 briefing 全文作为 prompt 调 DSH 原生视觉子代理（subagent_vision 等）
③ gewu_locate  真值核验：把审阅发现中的文字/数字定位回 HTML 源码（页码 + 行号），
               count=0 即 OCR 误读，不采信
```

实测收益：误报率显著下降（简报提供上下文）、关键数字零差错上会（源码核验）、整稿叙事线/密度/跨页一致性可审（子代理多图能力）。

## 模型无关性声明

本插件在视觉子代理 **mimo-v2.5（稳）** 与 **qwen3.7-plus（洞察强、误报略多）** 上实测验证。实测结论：**模型档位不决定审阅结果的可信度**——

- **简报契约（上下文）**消除无上下文误报：例如把业务标记 ⭐（核心能力）误判为装饰 emoji，实测在无简报的插件模式下系统性发生；
- **真值核验闭环（gewu_locate）**把 OCR 误读与页码偏移挡在采信之外：实测 qwen3.7-plus 的 3 个核心新论断中 2.5 个经不起源码核验，全部被核验环节拦截。

档位差异只体现在**审阅风格**（高挡洞察更锐、稳挡结论更保守），不体现在结果对错上。无论接入何种档位的视觉模型，本流水线产出均可信、可审计——这也是格物把「核验」固化为流水线第三步的原因。

## 安装

前置：Windows + Chrome/Edge + Node 24+（仅脚本验证用）。

**方式一：npm**（推荐，一行安装 + 一行挂载）

```powershell
npm i gewu-tools
pwsh node_modules\gewu-tools\scripts\install-gewu-plugins.ps1 -Install
# 或使用 DSH 插件管理器直接安装（需要 dsh.bundle manifest）
dsh plugin add gewu-tools
# 可选：注入自定义规范 preset（默认 community 零注入；也可用环境变量 GEWU_BRIEF_PRESET 指定）
pwsh node_modules\gewu-tools\scripts\install-gewu-plugins.ps1 -Install -Preset <preset文件路径>
```

**方式二：社区通道**（若已接入 awesome-dsh-plugins 生态）

```powershell
pwsh <workspace>\.dsh\setup\install-community-plugins.ps1 -Install
```

**方式三：独立脚本**（随项目分发）

```powershell
pwsh gewu\scripts\install-gewu-plugins.ps1 -Install    # 幂等
pwsh gewu\scripts\install-gewu-plugins.ps1 -Verify     # 只验证
pwsh gewu\scripts\install-gewu-plugins.ps1 -Uninstall  # 卸载
pwsh gewu\scripts\install-gewu-plugins.ps1 -Install -Preset <preset文件路径>  # 可选：注入自定义规范
```

`-Preset` 指定自定义规范 preset（默认 `community` 零注入；也可用环境变量 `GEWU_BRIEF_PRESET` 指定）。

安装脚本做的事：在 DSH 的 agent preset（默认 pre-sales，可用环境变量 `GEWU_PRESET` 覆盖）里追加 `gewu-tools` 挂载行，指向 `<workspace>\.dsh\gewu-tools`（安装位，项目目录的 Junction）。

**安装后必须重启 DSH 会话**（host 插件无热更新）。验证：`install-gewu-plugins.ps1 -Verify` 应四绿（preset 挂载行 / junction 链 / import 加载 / preset 预设加载）。

## 使用（主代理视角）

```text
1. gewu_prep(html_path="output\<客户>\<客户>_方案_vN.html",
             client="<客户>",
             background="<项目定位/关键决策/业务标记语义，如 ⭐=核心能力>")
   → 返回 { pages: [...], briefing: "..." }

2. 把 briefing 全文作为 prompt 调视觉子代理（subagent_vision）：
   → 逐页问题清单 + 整体结论

3. 对每条关键发现调 gewu_locate(html_path=..., needle=<发现中的文字/数字>)
   → 页码 + 行号；count=0 说明视觉模型 OCR 误读，该发现不采信
```

**gewu_prep 参数**

| 参数 | 说明 |
|---|---|
| `html_path` | 方案 HTML 路径（必填） |
| `client` / `background` | 写入简报的客户名与背景（强烈建议提供，上下文决定审阅质量下限） |
| `focus` | 关注问题清单（默认：版式/规范一致性/密度/图表可读性/核心论断/跨页一致性） |
| `out_dir` | 截图输出目录（默认 `<工作区>/_tmp_vision_test/<文件名>_shots`） |
| `width` / `height` | 视口尺寸（默认 1280x900） |
| `nav_offset` | sticky 顶导航偏移（默认 64，无 sticky 导航设 0） |

**gewu_locate 参数**：`html_path`、`needle`（待核验文字/数字）、`max_matches`（默认 8）。

## 自定义规范注入（preset）

preset 是格物的扩展点：你可以把自己的设计规范、验收标准写成一份 preset 文件，注入到 `gewu_prep` 生成的简报里，让视觉子代理按同一把尺子审阅你的页面。默认使用内置 `community` preset（零注入，保持与 1.0.0 一致的社区基线）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 非空字符串，preset 名称 |
| `version` | string | 非空字符串，preset 版本 |
| `defaultFocus` | string \| null | 覆盖默认关注问题清单；传 `null` 使用内置默认 |
| `sections` | string[] | 注入简报正文的规范/验收标准段落；单段 ≤ 2000 字，总长 ≤ 8000 字 |
| `dispatchHints` | string \| null | 调度提示（例如建议一次吃多少页）；可空 |
| `requires` | object | 预留扩展依赖声明；非法对象会导致降级 |

最小示例 `brief-preset.js`：

```js
export default {
  name: "my-design-standard",
  version: "1.0.0",
  defaultFocus: "版式一致性、信息密度、图表可读性",
  sections: [
    "视觉规范：主色 #123456，标题左对齐，卡片间距 24px。",
    "验收标准：每页必须有一条核心论断，核心数据需与业务标记语义一致。"
  ],
  dispatchHints: null,
  requires: {}
};
```

preset 文件非法时（非对象、缺少 `name`/`version`、字段类型不符、`sections` 超长等），格物自动回退 `community`，并在 `gewu_prep` 返回 `preset_degraded: true` 与 `preset_error` 说明原因。

## CLI 用法（跨宿主）

`index.js` 可脱离 DSH 独立运行；无 DSH 宿主（Trae/Codex/Kimi 等）可经此 CLI 获得与插件同源的截图+简报+核验产物。

```powershell
# 截图 + 简报（与 gewu_prep 同源）
node gewu\index.js --prep <html> [--client <客户>] [--background "..."] [--focus "..."] [--out-dir <dir>] [--width <n>] [--height <n>] [--nav-offset <n>]

# 真值核验（与 gewu_locate 同源）
node gewu\index.js --locate <html> --needle "<文本/数字>" [--max-matches <n>]

# 冒烟别名（旧位置参数，等同快速自检）
node gewu\index.js <html> [outDir]
```

产物：`--prep` 在 `--out-dir`（默认 `_tmp_vision_test/<文件名>_shots`）写 `prep_result.json` + `briefing.txt`；`--locate` 在 `_tmp_vision_test/<文件名>_locate/` 写 `locate_result.json`。

退出码：`0` 成功；`1` 业务失败（HTML 不存在、截图失败等）；`2` 参数错误。

## 工作原理

- **截图**：读 HTML 的 `<section>` 锚点（优先 `v2-page` 类），逐页用 headless Chrome 视口截图；sticky 导航经 iframe 上移推出画面；无锚点自动降级整页长截图。宿主进程直起 Chrome——不受 DSH 受限沙箱对子进程命名管道的限制。
- **简报契约**（内置在 briefing 里，实测三坑的对应解法）：
  - 纪律声明：子代理跳过入口协议、不向用户提问、用 `read_image` 读图（防卡死）；
  - 伪影声明：固定视口截图会串页，底部出现下一节标题是截图伪影不是设计问题；页码归属按「视口内下一节内容归下一页」；
  - 输出要求：逐页「页码｜问题｜严重度｜修改建议」，只报可见问题。
- **真值核验**：`needle` 在源码中逐次定位，返回所在 section 页码 + 行号 + 脱标签摘录。

## 测试

```powershell
# 冒烟（不经 DSH，直接跑核心逻辑）：需 Chrome + node
node gewu\index.js <任意带锚点的 HTML 路径> [输出目录]
# 预期：mode=anchors ok=true pages=N failed=-
```

## 目录结构

```
gewu/
├── index.js                # 插件本体（cordis + defineTool，含 standalone CLI 入口）
├── package.json            # gewu-tools（dsh.bundle manifest）
├── cordis.patch.yml        # dsh plugin add 装配补丁
├── presets/                # 内置 community preset 与 preset 契约
├── README.md / README.en.md
├── CHANGELOG.md
├── LICENSE                 # MIT
├── docs/TESTING.md         # 实测方法与结论摘要
└── scripts/install-gewu-plugins.ps1   # 安装脚本（Install/Verify/Uninstall/DryRun）
```

## 兼容性

- DSH 0.1.0-rc.6（cordis 插件 + defineTool 接口）
- 依赖：仅 `@deepseek-ai/dsh-tools`（peer，经工作区 AiBridge 解析）
- 浏览器：自动探测 Chrome/Edge（Program Files / LocalAppData），无需配置

## 友情链接

以下项目与格物生态互补，欢迎关注。

- [兰亭 Folio](https://github.com/nyantused-cpun/folio)：深度语境审阅引擎
- [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit)：通用视觉工具箱，与本项目互补——它让模型看见，格物让审阅可信
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

## 维护与许可

- 版本：1.1.0（2026-08-17）；变更见 CHANGELOG.md
- 许可证：MIT
- 临时文件：wrapper 与 Chrome profile 自动清理