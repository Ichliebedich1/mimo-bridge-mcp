# Project Handover Status

## Scope

MiMo Bridge MCP after P0-P5.3 implementation, documentation cleanup, and Windows 10/11 x64 packaging preparation.

## Task Goal

Let Codex split and review work while MiMo performs bounded coding tasks through one shared localhost daemon, with low-token review and a user-friendly Windows launch/install path.

## Current Progress

- Branch: `master`.
- Committed Bridge baseline before this handoff-doc refresh: `master...origin/master [ahead 1]`.
- Latest committed Bridge HEAD before this handoff-doc refresh: `01d734f docs: record session manager fallback collaboration`.
- This handoff-doc refresh may be uncommitted if the user did not ask for a Git commit; always run `git status --short --branch` after context compression.
- P0-P5.3 implementation is complete locally.
- Shared daemon, HTTP MCP, admin UI, task queue, Worktree review, safe deletion, safe-delete visibility, low-token review, and `mimo_wait_task` are implemented.
- Windows launcher lifecycle controls, persisted config, desktop shortcut command, opt-in autostart command, portable ZIP build, EXE installer build, installer self-test, and release-validation script are implemented.
- Local EXE install was repaired after a real double-click test exposed a broken installed launcher script. The installed app now starts from `%LOCALAPPDATA%\MiMoBridgeApp`, uses `%LOCALAPPDATA%\MiMoBridge` for data, and reports MCP ready at `http://127.0.0.1:3210/mcp`.
- Current release target is Windows 10/11 x64.
- Current generated release artifacts are ignored under `artifacts/`.
- Cross-project MiMo collaboration test on 2026-06-23 fixed the external `Mimo Code 会话管理` tool. Bridge task `task_0a88377ff37d` was delegated to MiMo, waited with `mimo_wait_task`, reviewed with Review Package first, then Codex escalated to focused diff in the target repo and accepted the task.
- External Session Manager committed baseline before this handoff-doc refresh: `master...origin/master [ahead 2]`, latest docs commit `f3fc5efd docs: add session manager handover`, previous code commit `09f70d03 fix: fallback for cleaned Bridge worktree sessions`.

## Completed

- Live viewer enhancement is complete and locally verified: the read-only viewer now surfaces more MiMo-visible text and sanitized tool output summaries from runtime JSONL logs, with wider UI and multiline wrapping. It does not and cannot display hidden model chain-of-thought that MiMo CLI does not emit.

- One localhost daemon serves MCP, REST API, and the React admin UI.
- Codex and the browser share one task queue and runtime state.
- Review defaults to bounded Review Packages; focused diff/file/log reads are explicit escalation.
- Waiting uses `mimo_wait_task` instead of repeated Codex polling.
- Portable package command: `npm.cmd run package:portable`.
- Installer package command: `npm.cmd run package:installer`.
- Release validation command: `npm.cmd run validate:release`.
- Root README and third-party handoff were consolidated into current, short entry points.
- Obsolete historical snapshot docs were removed from the active documentation set.
- Installed launcher `.cmd` generation now writes `MIMO_BRIDGE_DATA_DIR` and `MIMO_BRIDGE_CONFIG` as single-line environment variables.
- Plain double-click installer launch now defaults to quiet install; autostart remains opt-in/off by default.
- Safe-delete visibility now surfaces backend-derived `can_delete`, `delete_blockers`, and `delete_label` in `/api/tasks` and `/api/tasks/:id`. The admin UI has a `可安全删除` filter and shows delete only when `can_delete` is true.
- Default Chinese display chain: ReviewPackage has optional `objective_zh` / `mimo_summary_zh` fields; admin UI prefers zh for title/objective/summary with English fallback; future task briefs request Chinese summaries. No external translation API.
- Real full-flow retest completed: Codex delegated the safe-delete visibility slice through MCP to MiMo, waited with `mimo_wait_task`, reviewed the bounded Review Package first, escalated only to focused diff for changed files, requested one small MiMo fix, merged the Worktree, and marked the task accepted.
- External Session Manager fallback is complete: `Mimo Code 会话管理` code commit `09f70d03 fix: fallback for cleaned Bridge worktree sessions` lets cleaned Bridge Worktree sessions open by falling back from stale `runtime/worktrees/.../task_xxx` directories to the original `config.workspace_path` stored in `runtime/tasks/task_xxx.json`. Docs commit `f3fc5efd docs: add session manager handover` records the handoff. The EXE at `release/MiMo-Code-Session-Manager.exe` was rebuilt and `python -m unittest -v` passed 14/14.

## Collaboration Needed

- Codex: keep planning/reviewing and use low-token wait/review rules.
- MiMo: execute bounded coding tasks inside allowed paths and task Worktrees.
- Third-party agents: use `PROJECT_MEMORY.md`, `AGENTS.md`, and this handover before touching code.
- External Session Manager docs: if continuing the local session manager tool, read `C:\Users\86172\Desktop\MiMo Code project\Mimo Code 会话管理\docs\HANDOVER_STATUS.md` and `docs\modules\bridge-session-fallback.md`.

## Remaining Work

1. Run `docs/RELEASE_VALIDATION.md` on clean Windows 10/11 x64 machines.
2. Validate double-click installer, portable ZIP, reboot/logon, no system Node, port conflict, first-run config, Codex MCP connection, real MiMo task, autostart opt-in, and uninstall behavior.
3. Audit active Worktree cancellation cleanup.
4. Connect `TokenBudgetManager` to real MiMo token events.
5. Improve MCP SDK client examples/documentation so `mimo_wait_task` calls pass a request timeout longer than `timeout_seconds`; otherwise the client can time out before daemon-side waiting returns. Documented in `docs/modules/low-token-wait.md` with 1800/3600s daemon-side wait examples and SDK request timeout guidance.
6. Implement P5.4 safe agent invocation wrapper from `docs/modules/safe-agent-invocation.md` to avoid Windows shell quoting and Chinese-path encoding failures during Codex/MiMo delegation.

## Risks / Blockers

- Live viewer boundary: it can display visible MiMo text and sanitized tool output that exists in JSONL logs; it cannot display private/hidden model reasoning that the CLI does not emit.

- `tests/runner-integration.test.mjs` hangs on Windows and is excluded from normal regression.
- Windows PTY tests can print `AttachConsole failed` and `TimeoutNaNWarning`; judge by exit code and regression result.
- Codex shell capture can lose direct stdout when launcher commands spawn the daemon; verify daemon health with `launcher.ps1 status -Json`.
- During the 2026-06-22 full-flow retest, the first `mimo_wait_task(timeout_seconds=600)` call used the MCP SDK default 60s request timeout and failed client-side. A later call with an explicit longer request timeout returned correctly. Treat this as caller usage debt, not a daemon failure.
- During the 2026-06-23 delegation test, several startup attempts failed before MiMo received a task because PowerShell/inline Node command strings mishandled Chinese paths or special characters. Treat this as invocation-layer debt, not a MiMo execution failure.
- When delegating to projects outside the Bridge repo, the folder must be present in Bridge `allowedRoots`. This machine now has `C:\Users\86172\Desktop\MiMo Code project\Mimo Code 会话管理` in `%LOCALAPPDATA%\MiMoBridge\config.json`; reproduce that setting on migrated machines before asking MiMo to modify the session manager.
- Review Package can show `changed_files: []` for `use_worktree=false` cross-project tasks even when the target repo changed. In that case, escalate to focused `git diff` inside the target repo instead of assuming no changes.
- Clean Windows validation is still the main external blocker before calling the package ready for general use.
- The local machine install path has been smoke-tested, but a separate clean Windows 10/11 validation pass is still required.

## Recommended Next Action

After context compression, read `PROJECT_MEMORY.md` first, then this file, then `docs/OPEN_TASKS.md`. If the next task concerns the local Session Manager, also read `C:\Users\86172\Desktop\MiMo Code project\Mimo Code 会话管理\docs\HANDOVER_STATUS.md` and `docs\modules\bridge-session-fallback.md`.

Next engineering action: run the release checklist on clean Windows 10/11 x64 machines, then update `PROJECT_MEMORY.md`, `docs/OPEN_TASKS.md`, and this file with the result. For further MiMo collaboration tests, keep using Review Package first and focused diff only when risk flags, `use_worktree=false`, or review notes require escalation.
