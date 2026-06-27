# Reasonix TUI Adapter

## Module Goal

Add Reasonix TUI as a first-class execution agent in MiMo Bridge MCP, aiming for MiMo-level task delegation, waiting, review, live viewing, and Codex-controlled acceptance.

## Task Goal

P6 should first adapt Reasonix TUI, not Reasonix GUI. The TUI adapter should run bounded coding tasks through `reasonix run`, capture logs/session records, and feed the same Bridge review pipeline used by MiMo. GUI integration should initially mean shared session records or safe opening, not GUI click automation.

## Current Status

P6.0-P6.21 Agent discovery, Reasonix one-shot execution, generic low-token task get/wait/reply, generic task lifecycle/status tools, safe client Agent commands including replies and token status, Reasonix session mapping, Admin UI integration/lifecycle/handoff/detail-read/open-action parity, agent-aware queue/path-conflict scheduling, Reasonix live/session parsing, safe session-folder opening, safe Reasonix GUI companion opening, explicit token/cost extraction, and generic Review Package summary fields are implemented locally.

Implemented:

- `AgentConfig` / `AgentProbeResult` types.
- `src/services/agent-registry.ts`.
- `src/tools/agent-list.ts`.
- MCP tool `agent_list`.
- REST route `GET /api/agents`.
- `GET /api/health` lightweight `agents.configured` summary.
- Persistent config `agents[]` validation and normalization.
- STDIO env config for `REASONIX_COMMAND`, `REASONIX_HOME`, `REASONIX_DEFAULT_MODEL`, `REASONIX_MODELS`, and `REASONIX_MAX_STEPS`.
- `src/services/reasonix-tui-runner.ts`.
- `src/services/reasonix-session-store.ts`.
- `src/tools/agent-start-task.ts`.
- `src/tools/agent-get-task.ts`.
- `src/tools/agent-wait-task.ts`.
- `src/tools/agent-reply-task.ts`.
- `src/tools/agent-cancel-task.ts`.
- `src/tools/agent-finish-task.ts`.
- `src/tools/agent-merge-task.ts`.
- `src/tools/agent-delete-task.ts`.
- `src/tools/agent-queue-status.ts`.
- MCP tool `agent_start_task`.
- MCP tools `agent_get_task`, `agent_wait_task`, and `agent_reply_task`.
- MCP tools `agent_cancel_task`, `agent_finish_task`, `agent_merge_task`, `agent_delete_task`, and `agent_queue_status`.
- REST route `POST /api/agent-tasks`.
- REST routes `GET /api/agent-tasks/:task_id`, `POST /api/agent-tasks/:task_id/wait`, and `POST /api/agent-tasks/:task_id/replies`.
- REST routes `POST /api/agent-tasks/:task_id/cancel`, `POST /api/agent-tasks/:task_id/finish`, `POST /api/agent-tasks/:task_id/worktree`, `DELETE /api/agent-tasks/:task_id`, and `GET /api/agent-queue`.
- Fake Reasonix one-shot Worktree Review Package test.
- Controlled real Reasonix smoke task `task_f8b579217015` succeeded with `max_steps=20`, changed only `notes/result.txt`, had `risk_flags: []`, and its temporary Worktree was discarded afterward.
- Reasonix session mapping: after a TUI run, Bridge scans only configured `REASONIX_HOME\projects` for in-window `.jsonl` session files, skips `.trash`, prefers task/workspace matches, and persists the best match as `agent_session_path`. Browser API responses sanitize this path.
- Admin UI first slice: Create Task can select MiMo or Reasonix TUI; MiMo tasks still call `/api/tasks`, Reasonix tasks call `/api/agent-tasks`; list/detail pages show agent badges; System page shows `/api/agents` status.
- Agent-aware queue/path conflict scheduling: `TaskQueue` stores `agentId`, `workspacePath`, and `editablePaths`; multiple MiMo and/or Reasonix tasks can run in parallel when editable paths do not overlap; unknown metadata remains queued.
- Reasonix reply/continue: `agent_reply_task` resumes with `reasonix run --resume <agent_session_path>` after validating the session file is under configured `REASONIX_HOME`; REST and admin UI replies are wired.
- Reasonix live/session parser: `src/services/reasonix-event-parser.ts` reads bounded Reasonix session JSONL tails, exposes visible assistant `content` as live messages, summarizes tool calls/results as folded tool events, redacts local paths/session/token/password/API-key patterns, ignores user/system records, and does not expose `reasoning_content`.
- Live viewer integration: `/api/tasks/:id/live` merges Bridge runtime JSONL events with Reasonix session events for `reasonix-tui` tasks and still returns session events when the Bridge round log is missing.
- Safe local open first slice: Admin UI can call `POST /api/tasks/:id/open` to open a task folder or Reasonix session folder. The daemon resolves paths from stored task state, validates Worktree/workspace/Reasonix-home boundaries, and does not return raw local paths to the browser.
- Token/cost extraction: Reasonix session parser extracts explicit `tokens`, `usage`, `token_usage`, `prompt_tokens`, `completion_tokens`, `total_tokens`, and `cost` fields when present. The runner records them into TokenBudget only when `total_tokens > 0`; no fields means no record.
- Token capability visibility: ready Reasonix TUI reports `capabilities.token_usage=true`, and the Admin UI Token page explains that MiMo and Reasonix both contribute only real logged token/cost values.
- Generic token status: MCP `agent_token_status` and safe client `agent-token-status` read the shared TokenBudget without using MiMo-only command names. `mimo_token_status` remains compatible.
- Generic Review Package summary: new Review Packages include `agent_summary` / `agent_summary_zh`; legacy `mimo_summary` / `mimo_summary_zh` stay as aliases for old clients.
- Generic lifecycle parity: Reasonix tasks can now be cancelled, accepted/abandoned, merged/discarded, deleted, and inspected in the queue through `agent_*` tools instead of borrowing `mimo_*` tool names. Optional `agent_id` guards reject mismatched tasks before mutating state.
- Safe scripted invocation: `scripts/mimo-bridge-client.mjs` now exposes `agent-list`, `agent-start`, `agent-wait`, `agent-reply`, `agent-start-and-wait`, `agent-review`, `agent-cancel`, `agent-finish`, `agent-merge`, `agent-discard`, `agent-delete`, `agent-queue`, and `agent-token-status`, preserving UTF-8 JSON file/stdin handling for Reasonix tasks and follow-up messages.
- Safe GUI companion opening: Admin UI can call `POST /api/tasks/:id/open` with `action=reasonix_gui` for Reasonix TUI tasks. The daemon launches an explicit `reasonix-gui` agent command when configured, otherwise infers `...\ReasonixDesktop\reasonix-desktop.exe` from Reasonix TUI `home_dir`/command. It sets the same `REASONIX_HOME`, does not accept browser-supplied paths or commands, and does not return raw local paths.
- Admin UI lifecycle parity: task detail buttons now call generic `/api/agent-tasks/:id/...` lifecycle routes for Reasonix tasks and keep `/api/tasks/:id/...` for MiMo tasks.
- Admin UI Codex handoff parity: "交给 Codex 审查" now copies Reasonix-specific low-context review commands (`agent-review` / `agent_get_task`) for Reasonix TUI tasks, while preserving MiMo review commands for MiMo tasks. The reply box also displays the actual Agent name.
- Admin UI detail-read parity: task detail refresh, focused file reads, diff reads, log tails, and full debug reads use `/api/agent-tasks/:id?...agent_id=reasonix-tui` for Reasonix tasks and keep `/api/tasks/:id?...` for MiMo tasks.
- Admin UI open-action parity: Reasonix task folder, session folder, and GUI buttons call `/api/agent-tasks/:id/open` with fixed actions plus `agent_id`; MiMo keeps `/api/tasks/:id/open`. The daemon validates agent ownership before resolving/opening any local target.

Not implemented yet:

- Direct Reasonix GUI deep-linking to a specific session.
- Real-world validation against more Reasonix token/cost field variants if future versions change the session JSONL shape.
- Wider real-world validation against multiple Reasonix session JSONL variants beyond the observed `role/content/tool_calls` shape.

Local discovery on this machine:

- Reasonix TUI process observed at `D:\DeepSeek-Reasonix\bin\reasonix.exe`
- Reasonix GUI process observed at `D:\DeepSeek-Reasonix\ReasonixDesktop\reasonix-desktop.exe`
- `Start-Reasonix-TUI.cmd` sets `REASONIX_HOME=D:\DeepSeek-Reasonix\ReasonixData`
- `Start-Reasonix-GUI.cmd` sets the same `REASONIX_HOME`
- `reasonix --help` supports:
  - `reasonix run [--model NAME] [--max-steps N] [-c|--continue] [--resume PATH] <task>`
  - `reasonix chat [--model NAME] [-c|--continue] [--resume]`
  - `reasonix serve`
  - `reasonix acp`
  - `reasonix doctor --json`
- Reasonix documentation says CLI and desktop share Reasonix home/session storage.
- Current real probe through Agent Registry returned:
  - status: `ready`
  - version: `dev`
  - default model: `deepseek`
  - sessions dir configured under `D:\DeepSeek-Reasonix\ReasonixData\sessions`
  - permission mode: `ask`
  - sandbox available: `false`
  - fake-runner P6.2 supports one-shot execution through `agent_start_task`.
  - real Reasonix smoke succeeded when `max_steps=20`; `max_steps=5` was insufficient and caused a false failure.
  - real Reasonix stores session JSONL files under `ReasonixData\projects\<encoded-project-path>\sessions\*.jsonl`.

## Entry Files Added

- `src/services/agent-registry.ts`
- `src/tools/agent-list.ts`

## Entry Files To Add Next

- `src/services/agent-runner.ts`

## Existing Files To Modify

- `src/services/mimo-runner.ts`
- `src/services/task-store.ts`
- `src/services/task-queue.ts` already handles first-pass agent/path conflict scheduling.
- `src/services/review-package.ts`
- `src/types.ts`
- `apps/local-daemon/src/daemon-config.ts`
- `apps/local-daemon/src/tool-context.ts`
- `apps/local-daemon/src/mcp.ts`
- `apps/local-daemon/src/admin-api.ts`
- `apps/admin-ui/src/App.tsx`
- `apps/admin-ui/src/types.ts`

## Public Interfaces

### Agent Config

```ts
type AgentConfig = {
  id: "mimo" | "reasonix-tui" | string;
  kind: "mimo" | "reasonix-tui" | "reasonix-gui";
  display_name: string;
  enabled: boolean;
  command?: string;
  home_dir?: string;
  default_model?: string;
  models?: string[];
  max_steps?: number;
};
```

### Agent Runner

```ts
type AgentRunner = {
  id: string;
  kind: string;
  probe(): Promise<AgentProbeResult>;
  start(task: TaskState, runtimeDir: string): RunnerHandle;
  reply?(task: TaskState, message: string, runtimeDir: string): RunnerHandle;
};
```

### Generic MCP Tools

- `agent_list`
- `agent_start_task`
- `agent_get_task`
- `agent_wait_task`
- `agent_reply_task`
- `agent_cancel_task`
- `agent_finish_task`
- `agent_merge_task`
- `agent_queue_status`
- `agent_delete_task`
- `agent_token_status`

Existing `mimo_*` tools stay and route to the generic layer with `agent_id="mimo"`.

## Implementation Approach

### Phase 1: Probe Only

Implement Reasonix health checks before running real tasks:

- Check executable exists.
- Run `reasonix version`.
- Run `reasonix doctor --json`.
- Report configured Reasonix home, default model, key presence, and session dir.

Do not expose secrets. Use redacted `doctor --json` output only.

Status: complete locally. Verified with fake Reasonix tests and a real local Reasonix probe.

### Phase 2: One-Shot Run

Run a task with `reasonix run`:

```text
reasonix run --model <model> --max-steps <n> "<brief>"
```

Bridge should:

- Set `REASONIX_HOME` explicitly.
- Set working directory to the task Worktree.
- Capture stdout/stderr or PTY output to Bridge runtime logs.
- Detect completion by process exit.
- Mark status `review` on exit code 0 and `failed` otherwise.
- Build a Review Package from git diff and bounded Reasonix output.

Status: fake-runner implementation and controlled real smoke are complete. The runner reuses existing `createStartTaskHandler` for allowedRoots, dynamic task scope, Worktree creation, queueing, and Review Package generation. Use `max_steps=20` or higher for realistic tasks; `max_steps=5` can stop Reasonix before it finishes otherwise valid work.

### Phase 3: Session Record Mapping

After a run, map the Bridge task to a Reasonix session JSONL:

- Locate Reasonix project session directory under Reasonix home.
- Record newest session file created/modified during the task window.
- Persist `agent_session_path` in task state.
- Keep path access bounded to Reasonix home/project session directories.

This is the key to later GUI visibility.

Status: implemented for one-shot runs. The first version does not parse session contents; it records the session path only. It intentionally avoids exposing the full session path to browser API responses.

### Phase 4: Continue / Reply

After session mapping is reliable, add reply support:

- Prefer `reasonix run --resume PATH <task>` for headless continuation.
- Keep the same Worktree and re-audit changes after each reply.
- Validate the resume path is inside configured `REASONIX_HOME`.

Status: complete for TUI resume. `agent_reply_task` uses the stored `agent_session_path`, advances the task round on successful follow-up, refreshes the Review Package, and keeps browser API responses sanitized.

### Phase 5: GUI Shared Session Viewing

Only after session mapping:

- Confirm GUI sees the same session when using the same `REASONIX_HOME`.
- Add safe admin action to open Reasonix GUI or session folder.
- Avoid editing GUI tab metadata unless the format is documented and stable.
- Do not automate GUI clicks as core execution.

Status: safe local-open is implemented for task folders, Reasonix session folders, and Reasonix GUI companion launch. Direct Reasonix GUI launch to a specific session is not implemented because current `reasonix --help` exposes no stable GUI session-open argument.

## Collaboration Needed

- Agent Registry: provide generic agent discovery and dispatch.
- Task Store: persist agent metadata and Reasonix session path.
- Task Queue: schedule by agent and editable path conflict.
- Review Package: consume generic `agent_summary`.
- Admin UI: show agent selector, badges, and Reasonix live output.
- Reasonix TUI adapter: run/probe/parse/session-map.

## Pending Work

- Validate additional real Reasonix session JSONL variants and extend the parser tolerantly if new stable fields appear.
- Validate Reasonix token/cost extraction against more real sessions if stable fields appear in future versions.
- Decide whether Bridge uses the user's existing `REASONIX_HOME` or a Bridge-managed Reasonix home.
- Decide default Reasonix model for Bridge tasks.
- Decide safe permission mode for non-interactive Reasonix execution.
- Validate real Reasonix resume behavior beyond the current fake-runner proof when the local model budget allows it.

## Risks / Blockers

- `reasonix run` may prompt for permission or input if not configured correctly.
- `reasonix chat` is interactive and may not be suitable for first headless execution.
- Session JSONL format may change; parser must be tolerant.
- GUI may not support opening a specific session from command line.
- Token/cost data may be unavailable in Reasonix logs.
- Running MiMo and Reasonix concurrently without path conflict checks can corrupt work.

## Test Method

Focused tests:

- `node --test tests/agent-registry.test.mjs`
- `node --test tests/reasonix-event-parser.test.mjs`
- `node --test tests/live-task-view.test.mjs`
- `node --test tests/reasonix-session-store.test.mjs`
- `node --test tests/task-queue.test.mjs`

Integration smoke:

- `agent_list` returns MiMo and Reasonix TUI status.
- A fake Reasonix runner completes one task and produces a Review Package.
- `agent_get_task` returns a bounded Review Package for Reasonix tasks without full diff/log/source.
- `agent_wait_task` waits locally and returns bounded review evidence or a minimal timeout response.
- `reasonix-session-store` maps `.jsonl` session files under `REASONIX_HOME\projects` and ignores `.trash`/out-of-window files.
- `reasonix-event-parser` surfaces assistant-visible messages, folds tool calls/results, redacts local paths/secrets, and skips user/system/reasoning content.
- `/api/tasks/:id/live` can include Reasonix session events without exposing `agent_session_path`.
- `POST /api/tasks/:id/open` opens only backend-resolved task/session folders and never accepts arbitrary browser paths.
- Reasonix token extraction records only explicit session JSONL token/cost fields and does not estimate usage from text.
- `/api/agents` reports `token_usage=true` for ready Reasonix TUI because Bridge records explicit session JSONL token/cost fields when they exist.
- `agent_list_tasks` / safe client `agent-tasks` lists recent Reasonix tasks with sanitized and truncated summaries, risk flags, review recommendation, Worktree state, and safe-delete metadata. It must not expose raw Reasonix session paths, raw logs, full source, or full diffs.
- `agent-token-status` reads shared TokenBudget status without resetting it.
- Review Package contains `agent_summary` / `agent_summary_zh` and legacy `mimo_summary` / `mimo_summary_zh`.
- A real Reasonix probe reports configured/missing without crashing.
- A real one-shot Reasonix task runs only after the probe and fake-runner tests pass; current local smoke succeeded with `max_steps=20`.

Normal regression:

- Keep excluding `tests/runner-integration.test.mjs` on Windows unless the hang is fixed.
