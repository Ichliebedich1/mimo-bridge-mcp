# Project Handover Status

## Scope

MiMo Bridge MCP after P0-P5.3 implementation, documentation cleanup, and Windows 10/11 x64 packaging preparation.

## Task Goal

Let Codex split and review work while MiMo performs bounded coding tasks through one shared localhost daemon, with low-token review and a user-friendly Windows launch/install path.

## Current Progress

- Branch: `master`.
- Latest known pre-cleanup HEAD: `c94e399 docs: add release validation checklist`.
- P0-P5.3 implementation is complete locally.
- Shared daemon, HTTP MCP, admin UI, task queue, Worktree review, safe deletion, low-token review, and `mimo_wait_task` are implemented.
- Windows launcher lifecycle controls, persisted config, desktop shortcut command, opt-in autostart command, portable ZIP build, EXE installer build, installer self-test, and release-validation script are implemented.
- Current release target is Windows 10/11 x64.
- Current generated release artifacts are ignored under `artifacts/`.

## Completed

- One localhost daemon serves MCP, REST API, and the React admin UI.
- Codex and the browser share one task queue and runtime state.
- Review defaults to bounded Review Packages; focused diff/file/log reads are explicit escalation.
- Waiting uses `mimo_wait_task` instead of repeated Codex polling.
- Portable package command: `npm.cmd run package:portable`.
- Installer package command: `npm.cmd run package:installer`.
- Release validation command: `npm.cmd run validate:release`.
- Root README and third-party handoff were consolidated into current, short entry points.
- Obsolete historical snapshot docs were removed from the active documentation set.

## Collaboration Needed

- Codex: keep planning/reviewing and use low-token wait/review rules.
- MiMo: execute bounded coding tasks inside allowed paths and task Worktrees.
- Third-party agents: use `PROJECT_MEMORY.md`, `AGENTS.md`, and this handover before touching code.

## Remaining Work

1. Run `docs/RELEASE_VALIDATION.md` on clean Windows 10/11 x64 machines.
2. Validate double-click installer, portable ZIP, reboot/logon, no system Node, port conflict, first-run config, Codex MCP connection, real MiMo task, autostart opt-in, and uninstall behavior.
3. Audit active Worktree cancellation cleanup.
4. Connect `TokenBudgetManager` to real MiMo token events.

## Risks / Blockers

- `tests/runner-integration.test.mjs` hangs on Windows and is excluded from normal regression.
- Windows PTY tests can print `AttachConsole failed` and `TimeoutNaNWarning`; judge by exit code and regression result.
- Codex shell capture can lose direct stdout when launcher commands spawn the daemon; verify daemon health with `launcher.ps1 status -Json`.
- Clean Windows validation is still the main external blocker before calling the package ready for general use.

## Recommended Next Action

Run the release checklist on clean Windows 10/11 x64 machines, then update `PROJECT_MEMORY.md`, `docs/OPEN_TASKS.md`, and this file with the result.
