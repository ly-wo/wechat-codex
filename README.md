# WeChat Codex Bridge

在微信里向本机 Codex 发任务、接收进度与结果，支持文字、图片、文件、会话续接和微信命令。

基于 [Wechat-ggGitHub/wechat-claude-code](https://github.com/Wechat-ggGitHub/wechat-claude-code) 的 `5014307` 改造，保留 MIT 许可证与上游历史。本仓库为 Codex 适配版，未发布 npm 包。[English](README_en.md)

## 快速开始

需要 macOS 或 Linux、Node.js >= 18、个人微信账号，以及安装并登录的 Codex CLI。已使用 `codex-cli 0.153.4` 完成真实模型调用及会话续接验证。

```sh
npm install -g @openai/codex
codex login
```

首次下载项目：

```sh
git clone https://github.com/ly-wo/wechat-codex.git
cd wechat-codex
```

在本项目目录运行（已经安装依赖时跳过 `npm install`）：

```sh
npm install
npm run setup
npm run daemon -- start
```

`setup` 显示微信二维码，扫码后选择 Codex 工作目录。后台服务在 macOS 使用 launchd，Linux 优先使用 systemd 用户服务，无可用用户服务时使用后台进程。前台运行可用 `npm run run`。

```sh
npm run daemon -- status
npm run daemon -- stop
npm run daemon -- restart
npm run daemon -- logs
```

电脑需要保持开机、联网且未休眠。服务只处理扫码绑定用户的消息；账号缺少绑定用户信息时会拒绝启动，请重新 setup。

## 微信命令

| 命令 | 行为 |
| --- | --- |
| `/help` | 查看帮助 |
| `/stop` | 取消当前 Codex 任务并清空排队消息 |
| `/clear` | 取消当前任务、清空排队消息与聊天记录，下一条消息新建会话；保留工作目录和模型 |
| `/cwd [路径]` | 查看或切换到已存在的目录；切换后新建会话 |
| `/model [名称]` | 查看或指定模型；`/model default` 恢复全局配置或 Codex 默认模型 |
| `/prompt [内容]` | 查看或设置全局补充指令；`/prompt clear` 清除；下一次任务生效 |
| `/skills [full]` | 查看项目、用户和本机插件缓存中的 Skill；full 显示描述 |
| `/<skill> [参数]` | 把对应 Skill 的路径和用户请求交给 Codex |
| `/status` | 查看目录、模型、会话 ID 和状态 |
| `/history [数量]` | 查看本地保存的聊天记录 |
| `/compact` | 下一次使用新上下文，只保留本地聊天记录；不执行 Codex 原生摘要压缩 |
| `/undo [数量]` | 删除本地聊天记录；不会撤销代码修改或 Codex 的内部上下文 |
| `/reset` | 重置会话，恢复全局工作目录和模型 |
| `/send <路径>` | 把本机文件发送到微信 |
| `/version` | 查看版本 |

文本回复按 Codex 完整消息事件推送，过滤推理和原始工具输出；不是逐字刷新。语音依赖微信消息附带的转写文本，暂不额外做语音识别。接收到的文件保存为临时文件，由 Codex 按路径读取。回复中识别出的常见文档、图片等文件会自动推送，也可使用 `/send`。

## 配置与权限

默认数据目录 `~/.wechat-codex/`，含 `accounts/`、`config.json`、`sessions/`、`logs/` 和轮询状态。可通过 `WECHAT_CODEX_DATA_DIR` 指定绝对路径；兼容原项目的 `WCC_DATA_DIR` 变量。Codex 版本不会自动导入 Claude 会话。

`config.json` 示例：

```json
{
  "workingDirectory": "/absolute/path/to/project",
  "sandbox": "workspace-write",
  "timeoutMs": 3600000,
  "systemPrompt": "请用中文回答"
}
```

| 字段 | 默认值 / 用途 |
| --- | --- |
| `workingDirectory` | `~/Documents/Codex`；首次 setup 可指定 |
| `model` | 可选；不填写时沿用本机 Codex 模型配置 |
| `codexPath` | 可选；Codex 可执行文件路径。否则使用 `CODEX_BIN` 或 PATH 中的 `codex` |
| `sandbox` | `workspace-write`，允许在工作区内编辑；可改为 `read-only` |
| `timeoutMs` | 单次任务默认 60 分钟，超时会停止进程并报告未完成 |
| `systemPrompt` | 可选；作为本次 Codex 的 `developer_instructions` 补充指令 |

桥接使用非交互模式，审批策略为 `never`，需要额外审批的操作会失败。此版本提供 `read-only` 和 `workspace-write` 两种权限，不启用跳过沙箱的启动参数。绑定用户可以通过微信修改工作区、读取文件和执行任务，应使用自己控制的微信账号。

使用同一个本机账号的 Codex 登录状态及配置（`CODEX_HOME` 也可指定）。后台安装会记录 Codex 路径及已设置的相关环境变量；修改这些变量后重新启动服务。服务配置文件权限为仅当前用户读写。不要在微信消息或日志里粘贴 API 密钥。

### 模型提示需要新版 Codex

如果日志出现 `requires a newer version of Codex`，应更新桥接实际调用的 Codex。仅更新桌面应用不一定会更新 PATH 中的独立 CLI。可在 `config.json` 设置 `codexPath` 指向已验证的新版可执行文件，例如 macOS 本机安装的 `/Applications/ChatGPT.app/Contents/Resources/codex`，然后重启桥接。启动日志 `Codex runtime ready` 会显示实际路径和版本。清空会话不能解决版本不兼容。

## 安装为 Codex Skill（可选）

把完整项目保存在固定目录，将该目录链接到用户 Skill 目录。例如，本项目位于 `~/Documents/Projects/wechat-codex`：

```sh
mkdir -p ~/.agents/skills
ln -s "$HOME/Documents/Projects/wechat-codex" "$HOME/.agents/skills/wechat-codex"
```

如果已有同名目录，先检查它，不要直接覆盖。重新进入 Codex 后可用 `$wechat-codex` 或“启动微信桥接”。本仓库的 `SKILL.md` 使用自身所在目录运行，不会下载上游 Claude 版本覆盖本项目。

## 验证与实现

```sh
npm run check
```

验证会构建 TypeScript 并运行本地测试，包含实际模拟子进程的 JSONL 分帧、stdin、图片生命周期、会话续接、取消、超时、错误状态，以及配置和 Skill 发现。测试使用临时数据目录，不连接微信或模型服务。

调用链：微信 iLink API → Node.js 消息队列 → `codex exec --json` / `codex exec resume` → 微信回复。Codex 会话 ID 保存在桥接数据中，Codex 的完整上下文由 CLI 自身维护。任务失败不会自动换新会话重跑，避免重复执行有副作用的操作。

已在本机用 Codex 0.153.4 实测 `gpt-6-astra` 新建会话和续接返回成功。首次使用仍需完成扫码并发送一条测试消息，确认当前微信收发链路可用。

接入依据：[OpenAI 非交互模式文档](https://learn.chatgpt.com/docs/non-interactive-mode)、[OpenAI Skill 文档](https://learn.chatgpt.com/docs/build-skills)。`docs/superpowers/` 保留上游设计记录，其中的 Claude 说明属于历史资料。

## License

[MIT](LICENSE)，保留上游作者版权声明。
