# Open Tasks

## Pending

- Run docs/RELEASE_VALIDATION.md on clean Windows 10/11 x64 machines: reboot/logon, no system Node, port conflict, first-run errors, and real user double-click flow.

- Design and implement P6 multi-agent dispatch so Codex can assign separate tasks to MiMo and Reasonix instead of choosing only one active provider.
- Audit active Worktree cancellation cleanup.
- Connect `TokenBudgetManager` to real MiMo token events.
- Document or wrap MCP SDK calls so `mimo_wait_task` request timeout is explicitly longer than `timeout_seconds`; default SDK timeout can fire before daemon-side waiting returns. Documented in `docs/modules/low-token-wait.md` with 1800/3600s examples; real remaining work is ensuring all SDK callers adopt the documented pattern.

## Completed

- Persistent config and build-free `start-production.ps1`.
- Windows launcher lifecycle controller and CLI: start/stop/restart/open/log/status, duplicate-instance guard, port-conflict report, first-run config wizard, desktop shortcut command, and opt-in autostart command.
- Local launcher smoke: status, duplicate start, safe stop, start to healthy daemon, shortcut creation, autostart disabled, and bounded logs.
- Portable package script: `npm.cmd run package:portable` creates `artifacts/MiMoBridge-portable-win10-win11-x64.zip` with bundled `node.exe`, built artifacts, pruned dependencies, package-local `data`, and no MiMo credentials/tasks/Worktrees.
- Installer package script: `npm.cmd run package:installer` creates `artifacts/MiMoBridgeSetup-win10-win11-x64.exe` by embedding the portable payload and installer script in a MinGW resource-stub EXE.
- Installer self-test: `artifacts/MiMoBridgeSetup-win10-win11-x64.exe -SelfTest` validates the embedded payload without installing.
- Release validation script: `npm.cmd run validate:release` rebuilds release artifacts, runs installer SelfTest, checks manifests and sensitive-file exclusions, and writes `artifacts/release-validation.json`.
- Local installer repair smoke: EXE-installed app under `%LOCALAPPDATA%\MiMoBridgeApp` starts with bundled Node; `/api/health` returns ok, MCP ready, MiMo configured, and an empty queue.
- Portable smoke: package-local config on port 3211 started successfully, `/api/health` returned ok/MCP ready/MiMo configured, then the smoke daemon was stopped.
- Follow-up MiMo rounds stay inside their task Worktree and are re-audited.
- Read-only live-run viewer with bounded JSONL tail parsing and no stdin/control surface.
- Real Codex -> MCP -> MiMo -> review -> merge collaboration workflow.
- Normal regression after live viewer: 223/223.
- Temporary detached daemon proof using an on-demand Scheduled Task with no trigger.
- P4.6 `mimo_wait_task` committed, deployed, HTTP-smoked, and covered by the 228/228 normal regression. P4.6 low-token wait improvement: default 1800s, max 3600s, SDK request timeout documented.
- Documentation cleanup consolidated old root handoff/project snapshots and the old P5 UI design document into the active documentation set.
- Safe-delete visibility in the admin UI: backend now returns `can_delete`, `delete_blockers`, and `delete_label`; task list has a `可安全删除` filter; delete action is driven by backend `can_delete`. Verified through real Codex -> MCP -> MiMo -> review -> focused diff -> merge flow and `node --test tests/admin-api.test.mjs`.

## Risks

- The on-demand development Scheduled Task is not the final launcher or installer behavior.
- In the Codex shell harness, commands that spawn the daemon can lose direct stdout capture even when the daemon starts successfully; verify with `launcher.ps1 status -Json` until clean-machine double-click testing confirms normal console behavior.
- Automated browser interaction was not run; Playwright installation timed out.
- Known Runner integration hang and Windows PTY warning noise remain.

## Next Steps

1. Use `mimo_wait_task` for all later MiMo work instead of repeated polling.
2. Validate the launcher and installer on clean Windows 10/11 x64 machines and after reboot/logon.
3. Keep portable ZIP and EXE installer validation in the release checklist.
4. Start P6 with the design in `docs/modules/multi-agent-dispatch.md`: Agent Registry, generic `agent_*` tools, path-conflict scheduling, MiMo adapter migration, Reasonix TUI runner, and Reasonix GUI capability probe.
5. When using `mimo_wait_task` from an MCP SDK script, pass request options such as `{ timeout: (timeout_seconds + 20) * 1000 }` to avoid client-side timeout. See `docs/modules/low-token-wait.md` for the 1800/3600s examples.
