# Open Tasks

## Pending

- Run clean-machine/manual validation for the Windows 10/11 x64 launcher and installer: reboot/logon, no system Node, port conflict, first-run errors, and real user double-click flow.

- Audit active Worktree cancellation cleanup.
- Connect `TokenBudgetManager` to real MiMo token events.

## Completed

- Persistent config and build-free `start-production.ps1`.
- Windows launcher lifecycle controller and CLI: start/stop/restart/open/log/status, duplicate-instance guard, port-conflict report, first-run config wizard, desktop shortcut command, and opt-in autostart command.
- Local launcher smoke: status, duplicate start, safe stop, start to healthy daemon, shortcut creation, autostart disabled, and bounded logs.
- Portable package script: `npm.cmd run package:portable` creates `artifacts/MiMoBridge-portable-win10-win11-x64.zip` with bundled `node.exe`, built artifacts, pruned dependencies, package-local `data`, and no MiMo credentials/tasks/Worktrees.
- Installer package script: `npm.cmd run package:installer` creates `artifacts/MiMoBridgeSetup-win10-win11-x64.exe` by embedding the portable payload and installer script in a MinGW resource-stub EXE.
- Installer self-test: `artifacts/MiMoBridgeSetup-win10-win11-x64.exe -SelfTest` validates the embedded payload without installing.
- Portable smoke: package-local config on port 3211 started successfully, `/api/health` returned ok/MCP ready/MiMo configured, then the smoke daemon was stopped.
- Follow-up MiMo rounds stay inside their task Worktree and are re-audited.
- Read-only live-run viewer with bounded JSONL tail parsing and no stdin/control surface.
- Real Codex -> MCP -> MiMo -> review -> merge collaboration workflow.
- Normal regression after live viewer: 223/223.
- Temporary detached daemon proof using an on-demand Scheduled Task with no trigger.
- P4.6 `mimo_wait_task` committed, deployed, HTTP-smoked, and covered by the 228/228 normal regression.

## Risks

- The on-demand development Scheduled Task is not the final launcher or installer behavior.
- In the Codex shell harness, commands that spawn the daemon can lose direct stdout capture even when the daemon starts successfully; verify with `launcher.ps1 status -Json` until clean-machine double-click testing confirms normal console behavior.
- Automated browser interaction was not run; Playwright installation timed out.
- Known Runner integration hang and Windows PTY warning noise remain.

## Next Steps

1. Use `mimo_wait_task` for all later MiMo work instead of repeated polling.
2. Validate the launcher and installer on clean Windows 10/11 x64 machines and after reboot/logon.
3. Keep portable ZIP and EXE installer validation in the release checklist.
