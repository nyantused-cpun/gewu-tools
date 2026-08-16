# CHANGELOG

## 1.0.0 — 2026-08-16 初始发布

- 独立项目建立：本目录为单一事实源，安装位 `<workspace>\.dsh\gewu-tools` 与社区通道为 Junction 指向本项目
- 工具 `gewu_prep`：HTML 按锚点分区逐页渲染 PNG（宿主进程直起 headless Chrome，绕开受限沙箱命名管道限制）+ 自动生成视觉子代理简报契约（纪律声明/伪影声明/页码归属规则/输出要求）
- 工具 `gewu_locate`：文字/数字定位到 HTML 源码（页码 section id + 行号 + 脱标签摘录），count=0 即 OCR 误读不采信
- 安装双通道：社区通道（install-community-plugins.ps1 本地发布段）+ 独立脚本（scripts/install-gewu-plugins.ps1，Install/Verify/Uninstall/DryRun）
- 实测验证（24 页售前方案，方法见 docs/TESTING.md）：截图 40/40 成功；插件基线/视觉子代理（mimo、qwen3.7-plus）三路对比 + 源码真值核验；冷启动三坑与页码偏移已固化进简报契约

## 路线图（未排期）

- 截图 harness 升级元素边界截图（Playwright/JS 注入），根治串页伪影
- 可选：重档视觉模型常驻审阅（如 qwen3.7-plus，配置子代理路由即可）
