# Project Handover Status

## Scope

MiMo Bridge MCP after the first real Codex -> MCP -> MiMo -> Review Package -> merge workflow, P5.2 configuration stage, read-only live-run viewer, and the deployed P4.6 low-token wait protocol.

## Task Goal

Let Codex split and review work while MiMo performs bounded coding tasks through one shared localhost daemon, without repeated polling or large context reads.

## Current Progress

- Branch: `master`; HEAD: `cc59c1a Show latest completed MiMo task events`.
- P0-P5.1 are complete. P5.2 launcher/config/shortcut/autostart commands are implemented in the current launcher code.
- Follow-up MiMo rounds are forced back into the saved Worktree and re-audited; fix merged in `7e41770`.
- The read-only live-run viewer is merged in `fa952ab`; completed-task round selection is fixed in `cc59c1a`.
- Live endpoint: `GET /api/tasks/:id/live`; bounded to 100 events, 20,000 response characters, and a dynamically bounded file tail. It never attaches to MiMo stdin.
- Real API smoke returned 5 events from round 2 in 881 characters with no raw output/stdin fields.
- Normal regression after the live viewer: `223/223` passed, excluding `tests/runner-integration.test.mjs`.
- P4.6 `mimo_wait_task` is committed in `522e7a7` and loaded by the shared daemon.
- Root and daemon builds pass. Normal regression: `242/242`, excluding `tests/runner-integration.test.mjs`.
- Launcher focused regression: `11/11`. Local smoke verified launcher-owned health, duplicate start, safe stop/start, logs, desktop shortcut creation, and autostart disabled by default.
- HTTP MCP lists 11 tools. Terminal tasks return immediately; a running smoke fixture returned the minimal timeout payload after 1,004 ms and was deleted.

## Completed

- Persistent config defaults to `%LOCALAPPDATA%\MiMoBridge\config.json`; per-field environment variables override it.
- `start-local.ps1` is development build/start without machine-specific MiMo paths.
- `start-production.ps1` starts existing artifacts without compiling through the launcher CLI.
- Windows 10 x64 is the first release target; logon startup is opt-in; packages bundle Node but not MiMo credentials.
- A supervised MiMo task changed code in a Worktree, received focused Codex review/fixes, passed tests, and merged through MCP.
- Obsolete cancelled/review tasks were safely accepted/deleted; one accepted live-view task remains as a UI example.
- Daemon is currently healthy at `http://127.0.0.1:3210/`; MCP is ready, MiMo configured, queue empty.

## Collaboration Needed

- Codex: define launcher and packaging boundaries and use `mimo_wait_task` instead of repeated status polling.
- MiMo: execute bounded launcher/packaging subtasks; do not merge its own Worktree.
- Launcher: manage the existing daemon, not a second runtime.
- Distribution: package Windows 10 x64 Node/native dependencies; require MiMo installation and login on each device.

## Remaining Work

1. Use one `mimo_wait_task` call after each future start/reply instead of repeated `mimo_get_task` polling.
2. Validate the launcher on a clean Windows 10 x64 machine, including reboot/logon, no system Node, port conflict, first-run errors, and real double-click behavior.
3. Build Windows 10 x64 portable ZIP and installer with bundled Node and no MiMo credentials.
4. Audit active Worktree cancellation cleanup and connect real MiMo token events.

## Risks / Blockers

- `MiMoBridge-Dev-Daemon` is historical development scaffolding. The current running daemon is launcher-owned, but clean-machine launcher validation remains pending.
- In the Codex shell harness, start/restart commands that spawn the daemon can lose direct stdout capture; `launcher.ps1 status -Json` remains reliable and confirms health.
- Automated browser clicking was not run because Python Playwright was unavailable and installation timed out. UI build, static asset checks, API smoke, and tests passed.
- Windows PTY `AttachConsole failed` and `TimeoutNaNWarning` remain accepted test noise; exit codes and regression results are unaffected.
- `tests/runner-integration.test.mjs` remains excluded because it hangs.

## Recommended Next Action

Validate the P5.2 launcher on a clean Windows 10 x64 environment, then proceed to P5.3 portable ZIP and installer packaging.
