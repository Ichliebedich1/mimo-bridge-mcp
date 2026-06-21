# MiMo Bridge MCP

MiMo Bridge MCP lets Codex delegate bounded coding tasks to MiMo Code through one shared local daemon. Codex plans, constrains, reviews, and accepts work; MiMo executes inside task boundaries and Git Worktrees.

## Current Status

- Target OS: Windows 10/11 x64.
- Runtime: localhost-only Node daemon at `http://127.0.0.1:3210`.
- MCP endpoint: `http://127.0.0.1:3210/mcp`.
- Admin UI: served by the same daemon at `http://127.0.0.1:3210/`.
- Distribution: portable ZIP and EXE installer with bundled Node.
- MiMo Code must be installed and logged in separately on each machine.

## Important Docs

Read these first when taking over the project:

1. `PROJECT_MEMORY.md` - long-term project memory and current release state.
2. `AGENTS.md` - agent rules, collaboration workflow, and commands.
3. `docs/HANDOVER_STATUS.md` - short current handover summary.
4. `docs/OPEN_TASKS.md` - pending work and risks.
5. `docs/RELEASE_VALIDATION.md` - clean Windows validation checklist.
6. `docs/modules/windows-launcher-portability.md` - launcher, portable, and installer details.

## Build And Test

```powershell
npm.cmd run build
cd apps/admin-ui; npm.cmd run build; cd ../..
cd apps/local-daemon; npm.cmd run build; cd ../..
```

Normal regression excludes the known hanging runner integration test:

```powershell
$tests = Get-ChildItem -LiteralPath 'tests' -Filter '*.test.mjs' |
  Where-Object { $_.Name -ne 'runner-integration.test.mjs' } |
  ForEach-Object { $_.FullName }
node --test $tests
```

Focused release checks:

```powershell
node --test tests/release-validation.test.mjs tests/installer-package.test.mjs tests/launcher-controller.test.mjs
npm.cmd run validate:release
```

## Run Locally

Development start:

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/start-local.ps1
```

Launcher controls:

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 status
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 start -Open
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 stop
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 restart -Open
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 logs
```

## Package

```powershell
npm.cmd run package:portable
npm.cmd run package:installer
```

Generated release outputs are ignored by Git under `artifacts/`:

- `artifacts/MiMoBridge-portable-win10-win11-x64.zip`
- `artifacts/MiMoBridgeSetup-win10-win11-x64.exe`
- `artifacts/release-validation.json`

## Review Workflow

Codex should use the low-token protocol:

1. Start or reply to a MiMo task.
2. Call `mimo_wait_task` once with a bounded timeout.
3. Review `mimo_get_task(detail_level="review")`.
4. Escalate only to focused diff, file, or log reads when risk flags require it.
5. Merge or discard the task Worktree through MCP; MiMo must not merge its own Worktree.

Do not read the whole repository, full logs, complete diff, or unrelated files just for convenience.
