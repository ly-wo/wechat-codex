---
name: wechat-codex
description: 连接和管理本机 WeChat Codex Bridge，用于微信扫码绑定、启动、停止、重启桥接服务或查看桥接状态和日志。仅用于此项目的微信桥接管理。
---

# WeChat Codex Bridge

把此 SKILL.md 所在的完整项目目录作为工作目录。不要假设固定安装路径，也不要重新克隆上游 Claude 项目覆盖 Codex 版。

## 操作

先按请求检查相关状态：`package.json`、`dist/main.js`、`codex --version` 和 `npm run daemon -- status`。缺少依赖时在项目中执行 `npm install`；只修改了源码时执行 `npm run build`。安装和配置说明见 [README.md](README.md)。

- 扫码绑定：`npm run setup`。会显示二维码并等待用户扫码，再选择 Codex 工作目录。
- 启动后台服务：`npm run daemon -- start`。
- 停止、重启、查看状态或日志：`npm run daemon -- stop|restart|status|logs`，选择用户需要的一个操作。
- 前台运行：`npm run run`。

用户已明确要求具体操作时，检查后直接执行。只询问状态时保持只读。修改源码的请求不等于要求绑定微信或启动长期后台服务。

## 运行约定

- 需要 macOS 或 Linux、Node.js >= 18，以及已完成 `codex login` 的 Codex CLI。
- 数据默认在 `~/.wechat-codex`，也可由 `WECHAT_CODEX_DATA_DIR` 或兼容变量 `WCC_DATA_DIR` 指定。读取配置与凭证状态时不要输出令牌或密钥。
- 默认工作区写入沙箱和非交互审批策略，不为启动成功而放宽权限。
- `/stop` 取消当前任务；`/clear` 开启新会话；`/cwd` 切换目录；`/model` 切换模型；`/skills` 查看技能。
- `/compact` 只开启新上下文并保留本地记录，`/undo` 只删除本地记录；两者不回滚文件。
- Codex 出错时不会自动重跑任务。先检查日志、登录和配置，避免重复执行已有副作用的工作。

根据实际结果报告“已构建”“等待扫码”或“服务运行中”，不要把本地模拟测试当作真实微信收发成功。
