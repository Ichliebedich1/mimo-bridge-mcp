# MiMo Bridge MCP Long-Term Memory

This file is the project-local long-term memory. Update it after each meaningful phase so another agent can continue without relying on chat context.

## Current Release Target

- Target OS: Windows 10/11 x64.
- Distribution style: portable ZIP plus EXE installer.
- Runtime model: one localhost-only Node daemon shared by Codex MCP and the React admin UI.
- Internal MCP endpoint: http://127.0.0.1:3210/mcp.
- Autostart: off by default; only enable when the user explicitly opts in.
- Do not bundle MiMo credentials, MiMo login state, active tasks, runtime logs, or Git Worktrees.
- MiMo Code must be installed and logged in separately on each computer.

## Current Implementation State

- P0-P5.2 are implemented.
- P5.3 portable ZIP exists through npm.cmd run package:portable.
- P5.3 EXE installer is implemented through npm.cmd run package:installer.
- The installer is per-user: default app files go under LOCALAPPDATA\\MiMoBridgeApp; user data stays under LOCALAPPDATA\\MiMoBridge.
- Local package:installer build succeeds and produces the portable ZIP plus EXE installer. The user has also tried installing on a company computer, but the formal clean Windows 10/11 x64 release checklist is not fully recorded yet.
- Installer upgrade hardening is implemented: unknown setup flags are rejected, `-Help` is supported, reinstall verifies the old daemon is stopped before replacing files, locked native/runtime files abort safely, replacement uses staging plus rollback, setup logs go under LOCALAPPDATA\\MiMoBridge\\setup.log, and `-SelfTest` starts a temporary daemon to verify `/api/health` plus Admin UI HTML without installing.
- P5.4 Safe Agent Invocation is implemented through `scripts/mimo-bridge-client.mjs` and `scripts/mimo-bridge-client.ps1`.
- TokenBudgetManager is connected to real MiMo JSONL `part.tokens` / `part.cost` events through the runner for newly completed tasks.
- P6.0/P6.1 first slice is implemented locally: Agent Registry, `agent_list`, `/api/agents`, daemon health agent summary, and Reasonix TUI probe support. This stage only detects Reasonix and does not allow Reasonix to modify code yet.
- P6.2 first runner slice is implemented locally: `agent_start_task`, `/api/agent-tasks`, and `ReasonixTuiRunner` can run a one-shot Reasonix-style task through the existing Worktree, queue, scope, and Review Package flow. Verified with fake Reasonix; real Reasonix execution is still pending manual/safe smoke.

## Must-Preserve Architecture

- Keep the existing React admin UI and Node local daemon.
- Do not introduce Electron, Tauri, cloud hosting, LAN exposure, or a second task runtime without a new explicit decision.
- Codex plans/reviews/accepts; MiMo executes bounded coding tasks.
- MiMo must not merge its own Worktree.
- Review uses bounded Review Packages first; only read focused diff/files/logs when risk requires it.
- Waiting uses mimo_wait_task instead of repeated polling.

## Known Technical Debt

- tests/runner-integration.test.mjs hangs on Windows and is excluded from normal regression.
- Windows PTY tests can print AttachConsole failed and TimeoutNaNWarning; treat as noise only when tests exit 0.
- Active Worktree cancellation cleanup needs a focused audit.
- Clean-machine double-click, reboot/logon, no-system-Node, port-conflict, and uninstall validation are pending.
- MCP SDK callers must pass a request timeout longer than `mimo_wait_task.timeout_seconds`; otherwise the client can time out even though daemon-side low-token waiting is working. Documented in `docs/modules/low-token-wait.md` with 1800/3600s examples.
- Ad hoc inline Node/PowerShell agent-to-bridge calls should be replaced by the P5.4 safe client wrapper. Do not regress to command-line JSON construction.

## Next Handoff Checklist

1. Read this file first.
2. Run git status --short --branch.
3. Read docs/HANDOVER_STATUS.md, docs/OPEN_TASKS.md, and docs/modules/windows-launcher-portability.md.
4. If the issue involves the external Session Manager, read:
   - `C:\Users\86172\Desktop\MiMo Code project\Mimo Code 会话管理\docs\HANDOVER_STATUS.md`
   - `C:\Users\86172\Desktop\MiMo Code project\Mimo Code 会话管理\docs\modules\bridge-session-fallback.md`
5. Use npm.cmd run package:portable for the portable package.
6. Use npm.cmd run package:installer for the EXE installer.
7. Use npm.cmd run validate:release for automated local release validation, or npm.cmd run validate:release -- -SkipPackageBuild after artifacts already exist.
8. Use docs/RELEASE_VALIDATION.md for clean Windows 10/11 x64 manual validation.
9. Run focused tests before broad regression:
   - node --test tests/installer-package.test.mjs
   - node --test tests/launcher-controller.test.mjs
10. Normal regression must continue excluding tests/runner-integration.test.mjs.

## Active Documentation Set

- Primary entry points: README.md, PROJECT_MEMORY.md, AGENTS.md, docs/HANDOVER_STATUS.md, and docs/OPEN_TASKS.md.
- Architecture and module references: docs/ARCHITECTURE.md, docs/MODULE_MAP.md, docs/DECISIONS.md, docs/PROJECT_BRIEF.md, docs/RELEASE_VALIDATION.md, and docs/modules/*.md.
- Third-party takeover entry: docs/THIRD_PARTY_AGENT_HANDOFF.md is now a short index, not a duplicated long-form state dump.
- Removed from active docs during cleanup: root HANDOFF.md, root PROJECT.md, and docs/UI_DEVELOPMENT.md. Do not depend on those paths for current facts.
- Current release artifacts stay ignored under artifacts/. The portable staging directory artifacts/portable/MiMoBridge is kept because validate-release.ps1 -SkipPackageBuild reads it.

## Latest Notes

- Context-compression checkpoint on 2026-06-23: committed baseline before this handoff-doc refresh was Bridge `master...origin/master [ahead 1]` at `01d734f docs: record session manager fallback collaboration`, and external Session Manager `master...origin/master [ahead 2]` at `f3fc5efd docs: add session manager handover` with previous code commit `09f70d03 fix: fallback for cleaned Bridge worktree sessions`. This checkpoint may itself be an uncommitted documentation edit if the user did not ask for a Git commit. Re-run `git status --short --branch` after resuming.
- Cross-project Session Manager repair completed on 2026-06-23. User issue: MiMo sessions created by Codex/MiMo Bridge could appear in `Mimo Code 会话管理` but fail to open after their Bridge Worktree was merged/cleaned. MiMo task `task_0a88377ff37d` implemented the main fix in the external repo; Codex reviewed via low-token Review Package, escalated to focused target-repo diff because `use_worktree=false` reported no changed_files, added one missing session_id-scan fallback test/fix, rebuilt `release/MiMo-Code-Session-Manager.exe`, accepted the Bridge task, and committed target repo `09f70d03 fix: fallback for cleaned Bridge worktree sessions`. Session Manager docs were then committed as `f3fc5efd docs: add session manager handover`.
- Local Bridge config now includes `C:\Users\86172\Desktop\MiMo Code project\Mimo Code 会话管理` in `%LOCALAPPDATA%\MiMoBridge\config.json` allowedRoots so MiMo can work on that external project. This is local machine state, not a Git-tracked code change and must be recreated on another computer.

- Live viewer enhancement completed and locally verified: `/api/tasks/:id/live` now shows more MiMo-visible runtime text from `part.text`, `state.output`, `state.metadata.output`, and `state.error` in the existing `summary` field. Local paths/session/stdin/token/password values are sanitized; summary budget is raised from 200 to 1000 chars; admin UI live viewer is wider and preserves multiline text. Boundary: this cannot show hidden model chain-of-thought, only text already emitted into MiMo JSONL logs.

- Win11 support is treated as the same Windows x64 release line as Win10 because both are NT 10.x and the current stack is Node/PowerShell/localhost.
- The installer is a MinGW resource-stub EXE that embeds install.ps1 and the portable payload; it should not require system Node on the target computer.
- The installer-created launchers set MIMO_BRIDGE_NODE_PATH, MIMO_BRIDGE_DATA_DIR, and MIMO_BRIDGE_CONFIG explicitly.
- Latest local verification: npm.cmd run package:installer passed; npm.cmd run validate:release -- -SkipPackageBuild passed and wrote artifacts\release-validation.json; artifacts\MiMoBridgeSetup-win10-win11-x64.exe -SelfTest -SelfTestPort 33211 passed; node --test tests/launcher-controller.test.mjs tests/installer-package.test.mjs tests/release-validation.test.mjs passed 20/20.
- Installer EXE supports -SelfTest. This extracts the embedded payload to TEMP, checks required app files, rejects bundled runtime data or MiMo credential files, starts a temporary daemon from bundled node.exe, verifies health and Admin UI HTML, then stops the temporary process without installing anything.
- Documentation cleanup consolidated stale handoff/design snapshots into the active docs listed above and removed obsolete ignored build artifacts that can be regenerated.
- Installer repair after local double-click test: the EXE had installed files but generated installed launcher environment variables across multiple lines, making the app look missing/broken. Fixed `scripts/installer/install.ps1` to write explicit one-line installed launcher variables and fixed the EXE stub to default plain double-click installs to `-Quiet`.
- Current local installed app path: `%LOCALAPPDATA%\MiMoBridgeApp`; current data path: `%LOCALAPPDATA%\MiMoBridge`. After repair install, installed daemon started from bundled `node.exe`, `/api/health` returned ok, MCP status ready, MiMo configured, queue empty.
- Planned P6 is multi-agent dispatch, not provider replacement. Codex should be able to assign work to MiMo and Reasonix concurrently by explicit `agent_id`. Keep existing `mimo_*` tools compatible while adding generic `agent_*` tools. Reasonix TUI is the likely first executable adapter; Reasonix GUI needs a capability probe before any automation commitment.
- P6.0/P6.1 local probe result: `D:\DeepSeek-Reasonix\bin\reasonix.exe` with `REASONIX_HOME=D:\DeepSeek-Reasonix\ReasonixData` reports ready, version `dev`, default model `deepseek`, and providers from redacted `doctor --json`. The current `reasonix-tui` capabilities intentionally have `start_task=false` until the one-shot runner is implemented.
- P6.2 fake-runner proof: `agent_start_task(agent_id="reasonix-tui")` can create a task Worktree, run a Reasonix-compatible one-shot command, write visible output to Bridge JSONL logs, update task status to `review`, and generate a Review Package with changed files. Next step is a controlled real Reasonix smoke and then session mapping.
- P5.4 safe agent invocation is implemented. `scripts/mimo-bridge-client.mjs` supports `health`, `start`, `wait`, `start-and-wait`, and `review`; input comes from UTF-8 JSON file or stdin; wait uses MCP SDK with request timeout greater than `timeout_seconds`; CLI output is compact JSON and exits explicitly to avoid stale client processes. `scripts/mimo-bridge-client.ps1` is a thin launcher that locates Node and forwards arguments without constructing JSON.
- TokenBudgetManager now records real MiMo token usage at runner completion by summing `part.tokens` from JSONL events and using MiMo-provided `part.cost` when available. UI copy was updated so a zero value means no completed task has been recorded since daemon start/reset, not "not connected."
- Admin UI future planning: add backend-safe actions similar to the Session Manager tool for opening a task folder and opening a read-only/current session window. This is only planned; keep it behind localhost-only daemon routes and avoid exposing arbitrary path opens.
- Safe-delete visibility is implemented and merged via real Codex -> MCP -> MiMo -> Review Package -> focused diff -> merge flow. `/api/tasks` and `/api/tasks/:id` now return `can_delete`, `delete_blockers`, and `delete_label`; the admin UI has a `可安全删除` filter and only shows delete when backend-derived `can_delete` is true.
- Default Chinese display chain: `ReviewPackage` type has optional `objective_zh` and `mimo_summary_zh` fields. When objective or summary contains Chinese characters, the zh field is populated (same content); otherwise zh is omitted. Admin UI `detailToUiTask` prefers zh fields for title/objective/summary with English fallback. Task brief `prompt-builder.ts` adds a "语言要求" section requesting Chinese summaries. Codex handoff prompt also requests Chinese. No external translation API or dependency introduced.
- Latest safe-delete verification: `npm.cmd run build`, `cd apps/local-daemon; npm.cmd run build`, `cd apps/admin-ui; npm.cmd run build`, and `node --test tests/admin-api.test.mjs` passed. Daemon was restarted with `launcher.ps1 restart`; `/api/health` was ready and historical accepted/no-Worktree tasks returned `can_delete: true`, `delete_label: "可安全删除"`.
