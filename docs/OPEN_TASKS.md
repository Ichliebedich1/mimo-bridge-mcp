# Open Tasks

## Pending

- Implement the Windows 10 x64 one-click launcher with start/stop/restart/open/log/status controls.
- Add first-run configuration, desktop shortcut, and opt-in logon startup.
- Build portable ZIP and installer; bundle Node, never MiMo credentials/tasks/Worktrees.
- Audit active Worktree cancellation cleanup.
- Connect `TokenBudgetManager` to real MiMo token events.

## Completed

- Persistent config and build-free `start-production.ps1`.
- Follow-up MiMo rounds stay inside their task Worktree and are re-audited.
- Read-only live-run viewer with bounded JSONL tail parsing and no stdin/control surface.
- Real Codex -> MCP -> MiMo -> review -> merge collaboration workflow.
- Normal regression after live viewer: 223/223.
- Temporary detached daemon proof using an on-demand Scheduled Task with no trigger.
- P4.6 `mimo_wait_task` committed, deployed, HTTP-smoked, and covered by the 228/228 normal regression.

## Risks

- The on-demand development Scheduled Task is not the final launcher or installer behavior.
- Automated browser interaction was not run; Playwright installation timed out.
- Known Runner integration hang and Windows PTY warning noise remain.

## Next Steps

1. Use `mimo_wait_task` for all later MiMo work instead of repeated polling.
2. Build and validate the one-click launcher.
3. Package and test the Windows 10 x64 portable and installer artifacts.
