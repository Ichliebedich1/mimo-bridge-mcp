# Third-Party Agent Takeover Index

This file is intentionally short. Older long-form handoff snapshots were consolidated so a new agent does not have to reconcile stale project history.

## Read Order

1. `PROJECT_MEMORY.md`
2. `AGENTS.md`
3. `docs/HANDOVER_STATUS.md`
4. `docs/OPEN_TASKS.md`
5. `docs/RELEASE_VALIDATION.md`
6. `docs/MODULE_MAP.md`
7. `docs/modules/windows-launcher-portability.md`

If the task involves the external local Session Manager, also read:

1. `C:\Users\86172\Desktop\MiMo Code project\Mimo Code 会话管理\docs\HANDOVER_STATUS.md`
2. `C:\Users\86172\Desktop\MiMo Code project\Mimo Code 会话管理\docs\modules\bridge-session-fallback.md`

## Current Assignment

The project is past P5.3 implementation. The next useful work is release validation on clean Windows 10/11 x64 machines and small debt cleanup, not another architecture rewrite.

Latest committed cross-project baseline on 2026-06-23, before this handoff-doc refresh:

- Bridge repo expected state: `master...origin/master [ahead 1]`, latest commit `01d734f docs: record session manager fallback collaboration`.
- External Session Manager repo expected state: `master...origin/master [ahead 2]`, latest commit `f3fc5efd docs: add session manager handover`, previous code commit `09f70d03 fix: fallback for cleaned Bridge worktree sessions`.
- The Session Manager EXE was rebuilt at `C:\Users\86172\Desktop\MiMo Code project\Mimo Code 会话管理\release\MiMo-Code-Session-Manager.exe`.
- Local Bridge config includes the Session Manager folder in `allowedRoots`; this is machine-local and must be recreated on another PC.
- If this document was just updated for context compression, `git status` may show uncommitted documentation-only changes.

## Non-Negotiable Constraints

- Keep the existing React admin UI and Node localhost daemon.
- Keep MCP and UI on the same daemon at `127.0.0.1:3210`.
- Do not introduce Electron, Tauri, a cloud backend, LAN exposure, or a second task runtime without an explicit new decision.
- Autostart stays disabled by default and is enabled only by user action.
- Portable and installer packages bundle Node but do not bundle MiMo credentials, MiMo login state, active tasks, logs, or Worktrees.
- Codex reviews bounded Review Packages first and escalates only to focused evidence.

## Commands

```powershell
npm.cmd run build
cd apps/admin-ui; npm.cmd run build; cd ../..
cd apps/local-daemon; npm.cmd run build; cd ../..
npm.cmd run package:portable
npm.cmd run package:installer
npm.cmd run validate:release
```

Normal regression excludes the known hanging test:

```powershell
$tests = Get-ChildItem -LiteralPath 'tests' -Filter '*.test.mjs' |
  Where-Object { $_.Name -ne 'runner-integration.test.mjs' } |
  ForEach-Object { $_.FullName }
node --test $tests
```

## Expected Release Artifacts

- `artifacts/MiMoBridge-portable-win10-win11-x64.zip`
- `artifacts/MiMoBridgeSetup-win10-win11-x64.exe`
- `artifacts/release-validation.json`

These are ignored by Git. Rebuild them from scripts instead of committing binaries.

## Required Handoff Report

When finished, report:

- Git status and commit hash.
- Files changed.
- Commands run and pass/fail result.
- Whether clean Windows validation was run.
- Remaining risks or blockers.
