# Reasonix TUI Adapter

## Module Goal

Add Reasonix TUI as a first-class execution agent in MiMo Bridge MCP, aiming for MiMo-level task delegation, waiting, review, live viewing, and Codex-controlled acceptance.

## Task Goal

P6 should first adapt Reasonix TUI, not Reasonix GUI. The TUI adapter should run bounded coding tasks through `reasonix run`, capture logs/session records, and feed the same Bridge review pipeline used by MiMo. GUI integration should initially mean shared session records or safe opening, not GUI click automation.

## Current Status

P6.0-P6.5 Agent discovery, Reasonix one-shot execution, generic low-token task get/wait/reply, Reasonix session mapping, first Admin UI integration, and agent-aware queue/path-conflict scheduling are implemented locally.

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
- MCP tool `agent_start_task`.
- MCP tools `agent_get_task`, `agent_wait_task`, and `agent_reply_task`.
- REST route `POST /api/agent-tasks`.
- REST routes `GET /api/agent-tasks/:task_id`, `POST /api/agent-tasks/:task_id/wait`, and `POST /api/agent-tasks/:task_id/replies`.
- Fake Reasonix one-shot Worktree Review Package test.
- Controlled real Reasonix smoke task `task_f8b579217015` succeeded with `max_steps=20`, changed only `notes/result.txt`, had `risk_flags: []`, and its temporary Worktree was discarded afterward.
- Reasonix session mapping: after a TUI run, Bridge scans only configured `REASONIX_HOME\projects` for in-window `.jsonl` session files, skips `.trash`, prefers task/workspace matches, and persists the best match as `agent_session_path`. Browser API responses sanitize this path.
- Admin UI first slice: Create Task can select MiMo or Reasonix TUI; MiMo tasks still call `/api/tasks`, Reasonix tasks call `/api/agent-tasks`; list/detail pages show agent badges; System page shows `/api/agents` status.
- Agent-aware queue/path conflict scheduling: `TaskQueue` stores `agentId`, `workspacePath`, and `editablePaths`; different agents can run in parallel only when editable paths do not overlap; same-agent tasks and unknown metadata remain queued.
- Reasonix reply/continue: `agent_reply_task` resumes with `reasonix run --resume <agent_session_path>` after validating the session file is under configured `REASONIX_HOME`; REST and admin UI replies are wired.

Not implemented yet:

- Rich Reasonix session/live parser beyond bounded process output.
- Reasonix GUI shared-session opening/viewing.
- Reasonix token/cost extraction if session JSONL exposes real data.

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
- `src/services/reasonix-event-parser.ts`

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

## Collaboration Needed

- Agent Registry: provide generic agent discovery and dispatch.
- Task Store: persist agent metadata and Reasonix session path.
- Task Queue: schedule by agent and editable path conflict.
- Review Package: consume generic `agent_summary`.
- Admin UI: show agent selector, badges, and Reasonix live output.
- Reasonix TUI adapter: run/probe/parse/session-map.

## Pending Work

- Parse Reasonix session JSONL shape for richer live view and token/cost extraction if real fields exist.
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
- `node --test tests/reasonix-session-store.test.mjs`
- `node --test tests/task-queue.test.mjs`

Integration smoke:

- `agent_list` returns MiMo and Reasonix TUI status.
- A fake Reasonix runner completes one task and produces a Review Package.
- `agent_get_task` returns a bounded Review Package for Reasonix tasks without full diff/log/source.
- `agent_wait_task` waits locally and returns bounded review evidence or a minimal timeout response.
- `reasonix-session-store` maps `.jsonl` session files under `REASONIX_HOME\projects` and ignores `.trash`/out-of-window files.
- A real Reasonix probe reports configured/missing without crashing.
- A real one-shot Reasonix task runs only after the probe and fake-runner tests pass; current local smoke succeeded with `max_steps=20`.

Normal regression:

- Keep excluding `tests/runner-integration.test.mjs` on Windows unless the hang is fixed.
