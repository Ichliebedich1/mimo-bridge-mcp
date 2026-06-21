# Third-Party Agent Takeover Guide

**Date:** 2026-06-21  
**Repository:** `C:\Users\86172\Desktop\MiMo Code project\Agent 协作项目\mimo-bridge-mcp`  
**Current module:** P5.3 installer / clean-machine validation
**Target:** Windows 10 x64 only

## 1. Read This First

The MiMo Bridge core is already usable. Do not rebuild the project architecture or create another backend. P5.2 launcher code exists, and P5.3 portable ZIP generation now exists. The next job is clean-machine validation and Windows installer packaging.

P4.6 low-token waiting was completed immediately before this handoff. Its code is committed and deployed. The current uncommitted changes are documentation updates only and must not be discarded.

## 2. Exact Current State

- Git branch: `master`.
- Current code HEAD includes the Windows launcher lifecycle controls.
- Current uncommitted changes are portable packaging code and documentation updates.
- Running UI: `http://127.0.0.1:3210/`.
- Running MCP: `http://127.0.0.1:3210/mcp`.
- Last verified health: daemon `ok`, MCP `ready`, MiMo `configured`, queue empty.
- HTTP MCP exposes 11 tools, including `mimo_wait_task`.
- Normal regression: `242/242` passed, excluding the known hanging `tests/runner-integration.test.mjs`.
- Launcher focused regression: `11/11` passed.
- Root and local-daemon TypeScript builds pass.
- P5.2 launcher lifecycle commands, first-run wizard, shortcut command, and opt-in autostart command are implemented.
- P5.3 portable ZIP generation is implemented; Windows installer is not implemented.

Current uncommitted files include portable packaging and documentation updates:

- `apps/local-daemon/src/launcher-controller.ts`
- `.gitignore`
- `package.json`
- `scripts/build-portable.ps1`
- `tests/launcher-controller.test.mjs`
- `AGENTS.md`
- `docs/HANDOVER_STATUS.md`
- `docs/MODULE_MAP.md`
- `docs/OPEN_TASKS.md`
- `docs/PROJECT_BRIEF.md`
- `docs/modules/windows-launcher-portability.md`
- `docs/THIRD_PARTY_AGENT_HANDOFF.md` (this file)

Do not reset, checkout, overwrite, or delete these changes. Review and preserve them.

## 3. User Decisions That Must Not Change

1. First release supports **Windows 10 x64 only**.
2. Windows logon autostart is **off by default** and enabled only when the user checks an option.
3. Portable/install packages bundle Node, but never bundle MiMo credentials, MiMo login state, active tasks, runtime logs, or Git Worktrees.
4. MiMo Code must be installed and logged in separately on every destination computer.
5. Keep the existing React admin UI and Node local daemon. Do not rewrite the project with Electron, Tauri, a cloud backend, or another task runtime.
6. The service remains localhost-only. Do not expose it to LAN or public network interfaces.
7. The live task viewer is read-only. Never attach to MiMo stdin and never add command input or process-interruption controls to that viewer.
8. Codex plans, constrains, reviews, and accepts. MiMo performs bounded low-cost coding tasks. MiMo must not merge its own Worktree.

## 4. Completed Module Map

| Stage | Responsibility | Status |
|---|---|---|
| P0 | Fixed dependency and protocol baseline | Complete |
| P1 | Task lifecycle and MiMo PTY Runner | Complete |
| P2 | Reliability, cancellation, protocol tests | Complete; one Windows integration test remains excluded |
| P3 | Git Worktree isolation, diff audit, merge/discard | Complete |
| P4 | Real write-task serialization and queue | Complete |
| P4.5 | Bounded Review Package and token-budget review flow | Complete |
| P4.6 | One daemon-side wait instead of repeated Codex polling | Complete and deployed |
| P5 | Shared HTTP MCP, local daemon, React admin UI, Codex handoff | Complete |
| P5.1 | Safe permanent deletion of terminal tasks | Complete |
| P5.2 stage 1 | Persisted daemon config and build-free production start | Complete |
| P5.2 stage 2 | One-click launcher, setup wizard, shortcuts, optional autostart | Implemented; clean-machine validation pending |
| P5.3 | Windows 10 x64 portable ZIP and installer | Portable ZIP implemented; installer pending |

## 5. Existing Architecture

```text
Codex MCP client -----------\
                             > Node local daemon -> shared TaskStore/Queue -> MiMo CLI
React admin UI -> REST API -/                         |
                                                       -> Git Worktree -> Review Package
```

There must be exactly one daemon and one shared task state. The launcher manages that daemon; it does not create a second scheduler, TaskStore, MCP server, or admin API.

Main endpoints:

- Admin UI: `GET /`
- Health: `GET /api/health`
- MCP: `/mcp` using Streamable HTTP
- Task API: `/api/tasks`
- Read-only live view: `GET /api/tasks/:id/live`

## 6. Existing Runtime Configuration

Default config file:

```text
%LOCALAPPDATA%\MiMoBridge\config.json
```

`MIMO_BRIDGE_CONFIG` may point to another JSON file. Per-field environment variables override persisted values.

Persisted fields:

- `mimoNodePath`
- `mimoEntryPath`
- `allowedRoots`
- `runtimeDir`
- `port`

Existing startup split:

- `apps/local-daemon/start-local.ps1`: development flow; builds and starts.
- `apps/local-daemon/start-production.ps1`: production flow; starts existing build artifacts and must never compile.

The current daemon is kept alive by a temporary on-demand Scheduled Task named `MiMoBridge-Dev-Daemon`. It has no trigger and is only a development proof. Do not mistake it for the final autostart implementation.

## 7. P5.2 Work To Implement

Build a thin Windows launcher around the existing daemon. It must provide:

1. Start daemon.
2. Stop daemon.
3. Restart daemon.
4. Open the admin UI in the default browser.
5. Show daemon, MCP, MiMo, and port status in plain language.
6. Open bounded launcher/daemon logs.
7. Prevent duplicate daemon instances.
8. Detect port 3210 conflicts and explain whether the existing process is MiMo Bridge or another application.
9. Show clear errors for missing MiMo, invalid paths, missing build artifacts, invalid configuration, and failed health checks.
10. First-run setup for MiMo discovery, allowed project roots, runtime directory, port, and Codex MCP endpoint guidance.
11. Create a desktop shortcut.
12. Offer optional Windows logon startup, unchecked by default.
13. Wait for `/api/health` before reporting success or opening the UI.

Implementation order:

1. Lifecycle controller and single-instance/port checks.
2. Status and bounded log collection.
3. Minimal launcher interface using the controller.
4. First-run configuration wizard.
5. Desktop shortcut and opt-in logon Scheduled Task.
6. Automated tests and a real local smoke test.

Do not begin installer packaging until the generated portable ZIP passes on a clean Windows 10 x64 machine.

## 8. P5.2 Acceptance Criteria

- A non-programmer can start the system without typing PowerShell commands.
- Clicking Start twice never creates two daemon processes.
- Start uses built artifacts and does not run TypeScript or React builds.
- The launcher waits for health and reports the actual failure when startup fails.
- Stop terminates only the MiMo Bridge daemon owned by the launcher.
- Restart closes the old listener before starting the replacement.
- Open UI works only after health is ready, or clearly explains why it cannot open.
- Missing MiMo and invalid config are shown in plain Chinese rather than raw stack traces.
- Paths containing spaces and Chinese characters work.
- Log output is bounded and does not leak MiMo credentials or complete task transcripts.
- Autostart remains disabled unless explicitly selected.
- Existing HTTP MCP, admin UI, task queue, Worktrees, and Review Packages continue working.

## 9. Low-Token MiMo Collaboration Protocol

P4.6 exists specifically to prevent Codex from wasting context while waiting.

After starting or replying to a MiMo task:

1. Call `mimo_wait_task` once with a bounded timeout.
2. Do not poll `mimo_get_task` every minute.
3. On timeout, use exponential backoff and keep the response minimal.
4. On completion, review the returned Review Package first.
5. Read focused diff/file/log evidence only when a risk flag requires it.
6. Never read the entire repository or full logs merely for convenience.

Important `mimo_wait_task` inputs:

- `task_id`
- `timeout_seconds`: 1-600; default 300
- `detail_level`: `summary` or `review`; default `review`
- `max_chars`: 1000-20000; default 8000

Verified HTTP behavior:

- MCP tool count: 11.
- Existing terminal task returned immediately.
- Running smoke fixture returned only `task_id`, `status`, `completed`, `timed_out`, and `waited_ms` after about one second.
- The smoke fixture was deleted after verification.

## 10. Important Files

Read these first, in this order:

1. `docs/THIRD_PARTY_AGENT_HANDOFF.md`
2. `AGENTS.md`
3. `docs/HANDOVER_STATUS.md`
4. `docs/modules/windows-launcher-portability.md`
5. `docs/modules/low-token-wait.md`
6. `docs/modules/local-daemon-admin-ui.md`
7. `docs/OPEN_TASKS.md`

Relevant code:

- `apps/local-daemon/src/index.ts`: daemon startup and HTTP server.
- `apps/local-daemon/src/daemon-config.ts`: persisted config and environment overrides.
- `apps/local-daemon/src/mcp.ts`: HTTP MCP registration.
- `apps/local-daemon/src/admin-api.ts`: fixed REST routes.
- `apps/local-daemon/start-local.ps1`: development startup.
- `apps/local-daemon/start-production.ps1`: build-free production startup.
- `apps/admin-ui/`: existing React management interface.
- `src/tools/wait-task.ts`: P4.6 daemon-side wait.
- `src/services/task-store.ts`: persisted task state.
- `src/services/task-queue.ts`: shared write queue.
- `src/services/git-worktree.ts`: isolation and merge/discard.

## 11. Build And Test Commands

Run from the repository root unless a command changes directories.

```powershell
npm.cmd run build
```

```powershell
cd apps/local-daemon
npm.cmd run build
cd ../..
```

```powershell
cd apps/admin-ui
npm.cmd run build
cd ../..
```

Normal regression, intentionally excluding the known hanging test:

```powershell
$tests = Get-ChildItem -LiteralPath 'tests' -Filter '*.test.mjs' |
  Where-Object { $_.Name -ne 'runner-integration.test.mjs' } |
  ForEach-Object { $_.FullName }
node --test $tests
```

Expected current result: `242/242` pass. Windows may print `node-pty AttachConsole failed` and `TimeoutNaNWarning`; these are tracked test noise when the final process exits with code 0 and all tests pass.

Portable package command:

```powershell
npm.cmd run package:portable
```

Generated outputs are ignored by Git under `artifacts/`.

Do not silently add `tests/runner-integration.test.mjs` to the normal suite. It is known to hang and requires a separate repair task.

## 12. Safe Daemon Operations During Development

Current temporary task status:

```powershell
Get-ScheduledTask -TaskName 'MiMoBridge-Dev-Daemon'
```

Restart after rebuilding daemon code:

```powershell
Stop-ScheduledTask -TaskName 'MiMoBridge-Dev-Daemon'
```

Wait until port 3210 closes, then:

```powershell
Start-ScheduledTask -TaskName 'MiMoBridge-Dev-Daemon'
```

Verify:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3210/api/health' | ConvertTo-Json -Depth 6
```

Do not kill unrelated processes by port alone. Identify ownership first. Do not add a logon trigger to the temporary development task; final autostart belongs to the launcher and remains opt-in.

## 13. Git And Worktree Safety

- Start with `git status --short` and `git diff`.
- Preserve the current documentation changes.
- Never use `git reset --hard` or `git checkout --` on this workspace.
- MiMo task changes belong in the task Worktree, not the original repository.
- MiMo must not commit a merge into `master` by itself.
- Codex or the supervising agent reviews the bounded Review Package and decides merge/discard.
- The original repository must be clean before `mimo_merge_task` can safely merge a Worktree.
- Do not copy active Worktrees or runtime task state into distribution artifacts.

## 14. Known Technical Debt

These are real but do not block the first P5.2 implementation:

- `tests/runner-integration.test.mjs` hangs on Windows.
- Windows PTY tests emit `AttachConsole failed` and `TimeoutNaNWarning` noise.
- Real MiMo token events are not yet connected to `TokenBudgetManager`; the Token page is not authoritative.
- Active Worktree cancellation cleanup still needs a dedicated audit.
- Automated browser clicking was not completed because Playwright installation timed out. UI build, static asset checks, API smoke, and tests passed.
- The current Scheduled Task is a temporary manual-start development mechanism, not production startup.

## 15. Do Not Misclassify MiMo Failures

The user asked to stop and report if MiMo itself fails to operate for two or three consecutive attempts. Infrastructure issues such as a daemon restart, a temporary Scheduled Task launch problem, or the user opening a session window are not automatically MiMo failures.

Current consecutive MiMo execution failure count: **0**.

Before reporting a MiMo failure, distinguish:

- MiMo did not edit because the Bridge terminated it incorrectly.
- Daemon/MCP was unavailable.
- Task instructions or editable paths prevented changes.
- MiMo actually received a valid task and failed to execute it.

Only the last case counts toward the user's consecutive-failure rule unless evidence proves otherwise.

## 16. First Actions For The Taking-Over Agent

1. Read the seven files listed in section 10; do not scan the full repository first.
2. Run `git status --short` and confirm only documentation is dirty.
3. Review and commit the pending launcher smoke fixes and documentation updates.
4. Confirm `/api/health` and verify the MCP exposes 11 tools.
5. Validate the launcher by real double-click or interactive console on a clean Windows 10 x64 machine.
6. Verify reboot/logon behavior, no-system-Node behavior, port conflict handling, first-run errors, shortcut, and opt-in autostart.
7. Only then start Windows installer packaging.
8. Report changed files, test counts, risks, and the exact next stage.

## 17. Required Handoff Report Format

At the end of each stage, report:

- Objective completed.
- Exact changed files.
- Git commit hash.
- Build commands and results.
- Focused test count and normal regression count.
- Daemon health and MCP tool count after restart.
- Remaining risks or deviations.
- Whether MiMo was used, its task ID, and whether any attempt counts as an actual MiMo failure.

Do not claim completion based only on source changes. P5.2 requires a real local start/stop/restart/health smoke before acceptance.
