# WeChat Codex Bridge

Send tasks to your local Codex CLI from WeChat and receive progress, results, images and files. Adapted from [Wechat-ggGitHub/wechat-claude-code](https://github.com/Wechat-ggGitHub/wechat-claude-code), commit `5014307`, under its original [MIT license](LICENSE). This repository contains the Codex adaptation; no npm package has been published.

## Start

Requires macOS/Linux, Node.js 18+, a personal WeChat account and an authenticated Codex CLI. Live model calls and thread resumption were verified with Codex CLI 0.153.4.

```sh
npm install -g @openai/codex
codex login
git clone https://github.com/ly-wo/wechat-codex.git
cd wechat-codex
npm install
npm run setup
npm run daemon -- start
```

Scan the QR code and select a working directory during setup. Use `npm run run` for foreground mode. Manage the daemon with `npm run daemon -- status`, `stop`, `restart`, or `logs`. Keep the computer awake and connected.

## Configuration

Data lives in `~/.wechat-codex/`; override with an absolute `WECHAT_CODEX_DATA_DIR` (legacy `WCC_DATA_DIR` also works). `config.json` accepts `workingDirectory`, optional `model`, `systemPrompt`, `codexPath`, `sandbox` (`workspace-write` or `read-only`), and `timeoutMs` (default one hour). Codex uses the local CLI authentication and configuration, including `CODEX_HOME`. Binary resolution is `codexPath`, then `CODEX_BIN`, then `codex` in PATH.

No model is hardcoded. The noninteractive bridge uses `approval_policy="never"` and defaults to the workspace-write sandbox. Operations needing approval fail. Only the bound WeChat user can submit tasks. That user can request file reads, workspace edits and commands on this computer.

If a model reports `requires a newer version of Codex`, update the executable used by the bridge or point `codexPath` to a newer installed runtime, then restart the bridge. Startup logs record the resolved path and version. Clearing a conversation cannot fix runtime incompatibility.

## WeChat commands

- `/help`, `/status`, `/history [count]`, `/version`: inspect the bridge.
- `/stop`: cancel the current task and discard queued messages.
- `/clear`: cancel and clear the conversation while preserving directory and model.
- `/cwd [path]`: inspect or change the directory; changing it starts a new thread.
- `/model [name]`: inspect or change the model; `default` clears the session override.
- `/prompt [text]`: inspect or change global supplemental instructions; `clear` removes them.
- `/skills [full]`, `/<skill> [args]`: discover and invoke local skills.
- `/send <path>`: send a local file.
- `/compact`: start a fresh context next time, keeping only the local display history. It does not invoke native Codex summarization.
- `/undo [count]`: remove local display history only. It does not roll back files or Codex context.
- `/reset`: reset the session to global directory/model defaults.

Replies are streamed per completed agent message, excluding reasoning and raw tool output. Voice requires a transcript in the WeChat message. Pictures are passed with native `--image`; other attachments are downloaded for Codex to read. Failed coding tasks are never automatically replayed in a new thread.

## Optional Skill

Link the complete project directory into `~/.agents/skills/wechat-codex`. The included `SKILL.md` runs commands relative to itself and never downloads the upstream Claude implementation over this version.

## Verification

`npm run check` builds TypeScript and runs isolated local tests, including real fake-CLI subprocesses for JSONL framing, resume, attachments, cancellation and failures. Automated tests do not contact WeChat or a model provider. Separate live checks with Codex 0.153.4 and gpt-6-astra passed for new threads and resumption; scan and send a test message to verify your WeChat connection.

See the [Chinese README](README.md) for configuration details and [OpenAI's noninteractive mode documentation](https://learn.chatgpt.com/docs/non-interactive-mode) for the underlying CLI protocol. `docs/superpowers/` contains historical upstream design documents.
