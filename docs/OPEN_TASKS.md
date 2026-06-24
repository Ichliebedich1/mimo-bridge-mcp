# Open Tasks

## Pending

- Optimize direct MCP wait behavior: direct Codex MCP tool calls may time out around 30 seconds even though daemon-side `mimo_wait_task` continues correctly. The recovery inbox is implemented, but direct MCP waits should still get a short-call mode that returns `still_running` plus the safe-client wait command instead of trying to block for 30-60 minutes.
- Run and record docs/RELEASE_VALIDATION.md on clean Windows 10/11 x64 machines: reboot/logon, no system Node, port conflict, first-run errors, and real user double-click flow. The user has tried the installer on a company computer, but the formal checklist still needs written evidence.

- Continue P6 multi-agent dispatch so Codex can assign separate tasks to MiMo and Reasonix instead of choosing only one active provider. P6.0/P6.1 Agent Registry/probe and P6.2 Reasonix one-shot runner plus generic low-token get/wait/session mapping are implemented. Next is Admin UI agent selector and task agent badges, then agent-aware queue/path-conflict scheduling, MiMo adapter migration to generic tools, and GUI shared-session viewing.
- Audit active Worktree cancellation cleanup.
- Add admin UI actions for "open task folder" and "open current session window" using backend-safe localhost routes, borrowing the fallback/path-safety design from the external Mimo Code Session Manager. This is planning only; avoid arbitrary file-open routes and do not add a control surface to the read-only live viewer.

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
- Live viewer enhancement: surfaces MiMo-visible text/tool output summaries from JSONL logs, preserves multiline text, and sanitizes local paths/session/stdin/token/password values.
- Real Codex -> MCP -> MiMo -> review -> merge collaboration workflow.
- Normal regression after live viewer: 223/223.
- Temporary detached daemon proof using an on-demand Scheduled Task with no trigger.
- P4.6 `mimo_wait_task` committed, deployed, HTTP-smoked, and covered by the 228/228 normal regression. P4.6 low-token wait improvement: default 1800s, max 3600s, SDK request timeout documented.
- Documentation cleanup consolidated old root handoff/project snapshots and the old P5 UI design document into the active documentation set.
- Safe-delete visibility in the admin UI: backend now returns `can_delete`, `delete_blockers`, and `delete_label`; task list has a `可安全删除` filter; delete action is driven by backend `can_delete`. Verified through real Codex -> MCP -> MiMo -> review -> focused diff -> merge flow and `node --test tests/admin-api.test.mjs`.
- Default Chinese display chain: ReviewPackage now includes optional `objective_zh` and `mimo_summary_zh` fields; admin UI title/objective/summary prefer zh fields with English fallback; task briefs and Codex handoff prompts request Chinese summaries for future tasks. No external translation API used.
- Cross-project Session Manager fix: Bridge task `task_0a88377ff37d` delegated to MiMo, waited through `mimo_wait_task`, reviewed first by bounded Review Package, then escalated to focused diff because `use_worktree=false` produced no changed_files. Target repo code commit `09f70d03` rebuilt `release/MiMo-Code-Session-Manager.exe` and fixed cleaned Bridge Worktree session fallback. Target repo docs commit `f3fc5efd` added Session Manager handover docs.
- P5.4 Safe Agent Invocation: `scripts/mimo-bridge-client.mjs` and `scripts/mimo-bridge-client.ps1` are implemented. The client supports `health`, `start`, `wait`, `start-and-wait`, and `review`, reads UTF-8 JSON from file/stdin, uses REST where possible, uses MCP SDK for `mimo_wait_task` with request timeout greater than `timeout_seconds`, emits compact JSON, and exits cleanly to avoid stale one-off clients. Verified with `node --test tests/mimo-bridge-client.test.mjs`, `npm.cmd run build`, and real daemon `health/review/wait` smoke.
- TokenBudgetManager real MiMo token events: runner completion now sums MiMo JSONL `part.tokens`, records MiMo `part.cost` when available, and updates the admin UI copy. Verified with `node --test tests/event-parser.test.mjs tests/token-budget.test.mjs` and a fake-MiMo runner smoke showing 50 input / 50 output / 100 total / $0.001.
- P5.5 Dynamic Task Scope: task-specific `TaskScopePolicy`, persisted scope snapshots, admin UI scope fields, task-brief scope instructions, Review Package `scope_report`, and `OUT_OF_SCOPE_CHANGES` rejection are implemented and merged at `0497211 merge: accept dynamic task scope`. Verified with local-daemon build, root build, and 70/70 targeted tests.
- Origin Codex thread handoff: MiMo task `task_9dd5e0aefba0` added optional `origin_codex_thread_id`, `origin_codex_thread_url`, and `origin_source` fields through task creation, REST API, admin UI mapping, and safe Codex URL resolution. Codex reviewed via Review Package, focused diff, and tests, then applied the patch to the main worktree because unrelated dirty files prevented normal Worktree merge.
- Pending review recovery inbox: added `mimo_pending_reviews`, `GET /api/pending-reviews`, `health.pending_reviews.count`, and `scripts/mimo-bridge-client.mjs recover` so Codex can recover completed MiMo tasks after interrupted waits without polling full status, logs, source, or diff. Added a 10-minute thread heartbeat automation named "检查 MiMo 待审查任务" as an app-level fallback.
- P6.0/P6.1 Agent discovery: added Agent Registry, `agent_list`, `/api/agents`, daemon health agent summary, config `agents[]`, and Reasonix TUI probe support. Local real probe against `D:\DeepSeek-Reasonix\bin\reasonix.exe` and `D:\DeepSeek-Reasonix\ReasonixData` returned ready, version `dev`, and default model `deepseek`. Verified with root/local-daemon builds and 51/51 targeted tests.
- P6.2 Reasonix one-shot runner, generic low-token task control, and session mapping: added `agent_start_task`, `agent_get_task`, `agent_wait_task`, `/api/agent-tasks`, `/api/agent-tasks/:id`, `/api/agent-tasks/:id/wait`, `ReasonixTuiRunner`, `reasonix-session-store`, fake Reasonix fixture, and Worktree Review Package tests. Controlled real smoke task `task_f8b579217015` succeeded with `max_steps=20`; `max_steps=5` caused a false failure. The smoke Worktree was discarded and the task was marked accepted. Verified with root/local-daemon builds and `node --test tests/reasonix-session-store.test.mjs tests/agent-get-wait-task.test.mjs tests/agent-start-task.test.mjs tests/admin-api.test.mjs tests/stdio-protocol.test.mjs`.
## Risks

- The on-demand development Scheduled Task is not the final launcher or installer behavior.
- In the Codex shell harness, commands that spawn the daemon can lose direct stdout capture even when the daemon starts successfully; verify with `launcher.ps1 status -Json` until clean-machine double-click testing confirms normal console behavior.
- Automated browser interaction was not run; Playwright installation timed out.
- Known Runner integration hang and Windows PTY warning noise remain.
- Cross-project tasks outside the Bridge repo require explicit `allowedRoots` configuration. This machine includes `C:\Users\86172\Desktop\MiMo Code project\Mimo Code 会话管理` locally, but that setting is not part of Git.
- `use_worktree=false` Review Packages can miss target-repo changed_files; audit with focused target-repo `git diff` before accepting.

## Next Steps

1. Use `mimo_wait_task` for all later MiMo work instead of repeated polling.
2. After any interrupted MiMo wait or context compression, run `node scripts\mimo-bridge-client.mjs recover --limit 5 --max-chars 8000` before starting new work. If it returns 404, rebuild/restart the local daemon so it loads the recovery-inbox code.
3. Validate the launcher and installer on clean Windows 10/11 x64 machines and after reboot/logon.
4. Keep portable ZIP and EXE installer validation in the release checklist.
5. Continue P6 with the design in `docs/modules/multi-agent-dispatch.md` and `docs/modules/reasonix-tui-adapter.md`: next slice is Admin UI agent selector and task agent badges, then agent-aware queue/path-conflict scheduling, MiMo adapter migration to generic tools, and GUI shared-session viewing.
6. Use `scripts/mimo-bridge-client.mjs` or `.ps1` for scripted agent-to-bridge calls; do not return to inline JSON in PowerShell.
7. When using `mimo_wait_task` from an MCP SDK script outside the safe client, pass request options such as `{ timeout: (timeout_seconds + 20) * 1000 }` to avoid client-side timeout. See `docs/modules/low-token-wait.md` for the 1800/3600s examples.
8. If continuing the local `Mimo Code 会话管理` tool, start from `C:\Users\86172\Desktop\MiMo Code project\Mimo Code 会话管理\docs\HANDOVER_STATUS.md` and `C:\Users\86172\Desktop\MiMo Code project\Mimo Code 会话管理\docs\modules\bridge-session-fallback.md`.

