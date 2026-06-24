# Reasonix TUI Adapter

## Module Goal

Add Reasonix TUI as a first-class execution agent in MiMo Bridge MCP, aiming for MiMo-level task delegation, waiting, review, live viewing, and Codex-controlled acceptance.

## Task Goal

P6 should first adapt Reasonix TUI, not Reasonix GUI. The TUI adapter should run bounded coding tasks through `reasonix run`, capture logs/session records, and feed the same Bridge review pipeline used by MiMo. GUI integration should initially mean shared session records or safe opening, not GUI click automation.

## Current Status

P6.0/P6.1 Agent discovery is implemented locally.

Implemented:

- `AgentConfig` / `AgentProbeResult` types.
- `src/services/agent-registry.ts`.
- `src/tools/agent-list.ts`.
- MCP tool `agent_list`.
- REST route `GET /api/agents`.
- `GET /api/health` lightweight `agents.configured` summary.
- Persistent config `agents[]` validation and normalization.
- STDIO env config for `REASONIX_COMMAND`, `REASONIX_HOME`, `REASONIX_DEFAULT_MODEL`, `REASONIX_MODELS`, and `REASONIX_MAX_STEPS`.

Not implemented yet:

- `agent_start_task`.
- Reasonix TUI task execution.
- Reasonix Review Package generation.
- Reasonix session mapping.
- Agent-aware queue/path conflict scheduling.
- Admin UI agent selector.

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
  - `start_task` capability intentionally remains `false` until P6.2 is implemented.

## Entry Files Added

- `src/services/agent-registry.ts`
- `src/tools/agent-list.ts`

## Entry Files To Add Next

- `src/services/agent-runner.ts`
- `src/services/reasonix-tui-runner.ts`
- `src/services/reasonix-event-parser.ts`
- `src/services/reasonix-session-store.ts`
- `src/tools/agent-start-task.ts`
- `src/tools/agent-get-task.ts`
- `src/tools/agent-wait-task.ts`
- `src/tools/agent-reply-task.ts`

## Existing Files To Modify

- `src/services/mimo-runner.ts`
- `src/services/task-store.ts`
- `src/services/task-queue.ts`
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

### Phase 3: Session Record Mapping

After a run, map the Bridge task to a Reasonix session JSONL:

- Locate Reasonix project session directory under Reasonix home.
- Record newest session file created/modified during the task window.
- Persist `agent_session_path` in task state.
- Keep path access bounded to Reasonix home/project session directories.

This is the key to later GUI visibility.

### Phase 4: Continue / Reply

After session mapping is reliable, add reply support:

- Prefer `reasonix chat --resume <session_path>` or a documented resume mechanism.
- If Reasonix supports `run --resume PATH <task>`, prefer that for headless continuation.
- Keep the same Worktree and re-audit changes after each reply.

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

- Implement P6.2 Reasonix TUI one-shot runner.
- Confirm exact Reasonix session JSONL shape with local fixture files.
- Decide whether Bridge uses the user's existing `REASONIX_HOME` or a Bridge-managed Reasonix home.
- Decide default Reasonix model for Bridge tasks.
- Decide safe permission mode for non-interactive Reasonix execution.
- Add fake Reasonix fixtures before using the real binary in tests.

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
- A real Reasonix probe reports configured/missing without crashing.
- A real one-shot Reasonix task runs only after the probe and fake-runner tests pass.

Normal regression:

- Keep excluding `tests/runner-integration.test.mjs` on Windows unless the hang is fixed.
