# Open Tasks

## Pending

- Run clean-machine/manual validation for the Windows 10 x64 launcher: reboot/logon, no system Node, port conflict, first-run errors, and real user double-click flow.
- Build portable ZIP and installer; bundle Node, never MiMo credentials/tasks/Worktrees.
- Audit active Worktree cancellation cleanup.
- Connect `TokenBudgetManager` to real MiMo token events.

## Completed

- Persistent config and build-free `start-production.ps1`.
- Windows launcher lifecycle controller and CLI: start/stop/restart/open/log/status, duplicate-instance guard, port-conflict report, first-run config wizard, desktop shortcut command, and opt-in autostart command.
- Local launcher smoke: status, duplicate start, safe stop, start to healthy daemon, shortcut creation, autostart disabled, and bounded logs.
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
2. Validate the launcher on a clean Windows 10 x64 machine and after reboot/logon.
3. Package and test the Windows 10 x64 portable and installer artifacts.
