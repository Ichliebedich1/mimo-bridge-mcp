# Multi-Agent Dispatch

## Module Goal

Let Codex assign work to MiMo and Reasonix concurrently through one shared Bridge daemon, while preserving Worktree isolation, bounded review, low-token waiting, admin UI visibility, and Codex-controlled merge/acceptance.

P6 is not a provider switch. It is a multi-agent dispatch layer where MiMo remains supported and Reasonix becomes a peer execution agent.

Important dependency: P6 must reuse P5.5 Dynamic Task Scope. MiMo and Reasonix should both receive task-specific editable/read-only boundaries from the same `TaskScopePolicy`; do not create a separate Reasonix-only safety model.

## User Goal

Reasonix should eventually reach the same project role as MiMo:

- Codex can delegate a bounded coding task to Reasonix.
- Reasonix runs inside a task Worktree or an allowed project path.
- Codex can wait without polling.
- Codex receives a Review Package first.
- Codex can inspect focused diff/log/session evidence only when needed.
- Codex decides merge/discard/acceptance.
- The admin UI shows Reasonix task status, live output, queue state, token/cost evidence where available, and safe deletion state.

## Current Status

Planned. The current runtime is MiMo-first. Tasks, tools, config, queue, review package wording, and admin UI labels still assume MiMo. P6 should add a generic agent layer while keeping every existing `mimo_*` MCP tool compatible.

Observed local Reasonix installation on this machine:

- TUI binary: `D:\DeepSeek-Reasonix\bin\reasonix.exe`
- GUI binary: `D:\DeepSeek-Reasonix\ReasonixDesktop\reasonix-desktop.exe`
- Launcher TUI sets `REASONIX_HOME=D:\DeepSeek-Reasonix\ReasonixData`
- Launcher GUI sets the same `REASONIX_HOME`
- `reasonix --help` exposes `run`, `chat --continue`, `chat --resume`, `serve`, `acp`, `doctor --json`, and `version`
- Reasonix docs say CLI and desktop share Reasonix home/session storage

## Target Agents

| Agent ID | Role | First P6 status |
| --- | --- | --- |
| `mimo` | Existing MiMo Code execution adapter | Keep as production path |
| `reasonix-tui` | First Reasonix execution adapter via `reasonix run` / PTY | Implement first |
| `reasonix-gui` | Visual viewer/manual companion for Reasonix sessions | Do not automate first; share/read sessions only |

## Technical Route

Use Reasonix TUI as the executable runner first. Do not start by automating the GUI.

Preferred execution path:

```text
Codex / Admin UI
  -> agent_start_task(agent_id="reasonix-tui")
  -> Agent Registry
  -> ReasonixTuiRunner
  -> reasonix run --model <model> --max-steps <n> "<brief>"
  -> Bridge logs + Reasonix session JSONL
  -> Reasonix parser
  -> Review Package
  -> Codex review / merge / accept
```

Reasonix GUI path:

```text
Reasonix TUI task
  -> writes Reasonix session JSONL under Reasonix home/project sessions
  -> Bridge records session_path
  -> Reasonix GUI can show the same session if it reads the same Reasonix home
  -> Bridge may add "open Reasonix GUI/session" later as a safe local action
```

This route avoids brittle GUI click automation while still moving toward shared TUI/GUI session records.

## Feature Parity Target

| Capability | MiMo today | Reasonix target | P6 route |
| --- | --- | --- | --- |
| Start task | `mimo_start_task` | `agent_start_task(agent_id="reasonix-tui")` | Add generic tools and Reasonix adapter |
| Continue task | `mimo_reply_task` with session | Reasonix resume/continue | Phase 2 using `chat --resume` or session-aware run if supported |
| Low-token wait | `mimo_wait_task` | `agent_wait_task` | Reuse daemon-side wait over generic task status |
| Review package | MiMo summary/log/diff | Agent summary/log/diff | Add `agent_summary`, keep `mimo_summary` compatibility |
| Worktree isolation | Implemented | Same | Reuse Git Worktree module |
| Queue control | One write task per MiMo | One write task per agent plus path conflict scheduling | Agent-aware queue |
| Live viewer | MiMo text + folded tools | Reasonix text + folded tools | Add Reasonix output parser |
| Token/cost | MiMo JSONL token events | Reasonix token events if present | Parse session/log metadata, fallback unknown |
| Merge/discard | Codex only | Codex only | Reuse merge task |
| Safe deletion | Implemented | Same | Generic task deletion metadata |
| Admin UI | MiMo task list/detail | Agent badges, agent selector, per-agent status | Update task model and UI |
| GUI session visibility | External MiMo Session Manager exists | Reasonix GUI reads same Reasonix home/session path | Record `reasonix_session_path`, avoid GUI automation |

## Main Technical Difficulties

| Area | Difficulty | Impact | Mitigation |
| --- | --- | --- | --- |
| Runner completion signal | Need reliable way to know `reasonix run` is done | Wrong completion breaks review/queue | Use process exit as terminal signal in Phase 1; parse final summary when available |
| Session path discovery | Need map Bridge task to Reasonix session JSONL | GUI/session open depends on it | Discover Reasonix home/project session layout; record newest session file after run |
| Output parsing | Reasonix output may be human text, not MiMo JSON events | Live viewer/review summary weaker | Add `reasonix-event-parser.ts`; keep raw bounded logs |
| Continuation | MiMo has session id; Reasonix uses `--continue`/`--resume` | Reply flow may be less direct | Phase 1 can be start-only; Phase 2 adds resume using recorded session path |
| Token/cost data | Unknown whether Reasonix emits token/cost in CLI/session JSONL | TokenBudget may be incomplete | Probe session JSONL; if absent, report `unknown` not fake numbers |
| Permissions/Yolo | Reasonix has its own permission modes | Headless task may hang on approval | Configure non-interactive policy explicitly; prefer safe sandbox/worktree boundaries |
| Concurrency | Two agents can edit same files | Merge conflicts/data loss | Agent-aware path conflict scheduler; one write task per agent initially |
| GUI integration | GUI automation is brittle | Could steal focus or fail across machines | Do not automate GUI first; only share/read session records and optionally open GUI |
| Config portability | Reasonix paths differ per computer | New machine setup can fail | Store `agents[]` config with executable path, home dir, models, and health probe |
| Review compatibility | Existing fields say `mimo_summary` | UI/tools may assume MiMo | Introduce generic fields and keep MiMo aliases |

## Required Code Changes

### New Core Modules

- `src/services/agent-registry.ts`
  - Owns configured agents and their health/status.
  - Resolves `agent_id` to a runner adapter.

- `src/services/agent-runner.ts`
  - Defines shared `AgentRunner` interface:
    - `start(task, runtimeDir)`
    - `cancel(taskId)`
    - optional `reply(task, message)`
    - optional `probe()`

- `src/services/task-scope.ts`
  - Reused from P5.5.
  - Produces the effective editable/read-only paths that every agent receives.
  - Feeds agent-aware queue conflict checks and Review Package scope reports.

- `src/services/reasonix-tui-runner.ts`
  - Runs `reasonix.exe run`.
  - Captures stdout/stderr or PTY output into Bridge logs.
  - Records exit code, session path, summary, issues, and token data when available.

- `src/services/reasonix-event-parser.ts`
  - Extracts visible Reasonix text, tool calls, completion/failure signals, and possible token/cost metadata from output/session JSONL.
  - Feeds the same live viewer shape used by MiMo.

- `src/services/reasonix-session-store.ts`
  - Locates Reasonix home/project session directories.
  - Maps Bridge task -> Reasonix session file.
  - Supports later "open GUI/session" feature.

### Existing Modules To Modify

- `src/types.ts`
  - Add `agent_id`, `agent_name`, `agent_kind`, `agent_summary`, `agent_session_path`.
  - Keep `mimo_summary` and `session_id` compatibility for old clients.

- `apps/local-daemon/src/daemon-config.ts`
  - Add `agents[]` config:
    - `id`
    - `kind`
    - `displayName`
    - `command`
    - `homeDir`
    - `models`
    - `defaultModel`
    - `enabled`

- `src/services/mimo-runner.ts`
  - Wrap MiMo runner behind `AgentRunner`.
  - Do not break current behavior.

- `src/services/task-store.ts`
  - Persist generic agent metadata and Reasonix session path.

- `src/services/task-queue.ts`
  - Become agent-aware.
  - Permit different agents to run concurrently only when editable paths do not overlap.

- `src/services/review-package.ts`
  - Add generic `agent_summary`.
  - Populate MiMo fields as aliases when `agent_id="mimo"`.

- `src/tools/*`
  - Add generic `agent_*` tools.
  - Route `mimo_*` tools to generic handlers with `agent_id="mimo"`.

- `apps/local-daemon/src/mcp.ts`
  - Register `agent_list`, `agent_start_task`, `agent_get_task`, `agent_wait_task`, etc.

- `apps/local-daemon/src/admin-api.ts`
  - Expose agent list/status and generic task creation.

- `apps/admin-ui/src/App.tsx`
  - Add agent selector.
  - Show agent badges.
  - Show Reasonix TUI health/config.
  - Keep live viewer layout: agent replies primary, tool calls folded.

## Admin UI Requirements

- Show configured agents:
  - MiMo: configured/missing/running/error
  - Reasonix TUI: configured/missing/running/error
  - Reasonix GUI: viewer/manual companion, not automation runner
- Add task creation agent selector.
- Display task agent badge in list/detail/live viewer.
- Warn when selected editable paths overlap an active task on any agent.
- Add future safe buttons:
  - open task folder
  - open Reasonix session in GUI or open Reasonix home/session folder
- Keep live viewer read-only.

## P6 Development Flow

### P6.0 Discovery / Probe

Goal: prove Reasonix TUI can be controlled safely.

Tasks:

- Add documented local probes for `reasonix.exe version`, `doctor --json`, and `run`.
- Discover Reasonix session JSONL format and project session path mapping.
- Confirm if `reasonix run` can run without hanging on approvals.
- Confirm whether output or session JSONL includes token/cost data.
- Record findings in this document before coding the full adapter.

Acceptance:

- Bridge can report `reasonix-tui` as detected or missing.
- No task execution yet required.

### P6.1 Agent Registry + MiMo Adapter

Goal: add the generic layer without changing user behavior.

Tasks:

- Add `AgentRunner` and Agent Registry.
- Register existing MiMo as `agent_id="mimo"`.
- Add `agent_list`.
- Keep all `mimo_*` tools working.

Acceptance:

- Existing MiMo tests still pass.
- `agent_list` shows MiMo.

### P6.2 Reasonix TUI One-Shot Runner

Goal: Reasonix can run a new bounded task and return review status.

Tasks:

- Add Reasonix config fields.
- Add `ReasonixTuiRunner` using `reasonix run`.
- Store raw logs and detected session path.
- Parse visible summary/errors.
- Reuse Worktree and Review Package.

Acceptance:

- `agent_start_task(agent_id="reasonix-tui")` starts a task.
- `agent_wait_task` returns bounded review evidence.
- Admin UI shows the Reasonix task and live text.

### P6.3 Agent-Aware Queue

Goal: allow MiMo and Reasonix to work in parallel safely.

Tasks:

- Track active editable paths per agent.
- Allow disjoint tasks on different agents.
- Queue or reject overlapping tasks.
- Keep one write task per agent initially.

Acceptance:

- MiMo and Reasonix can run concurrently on different editable paths.
- Overlap is blocked or queued deterministically.

### P6.4 Reasonix Session Continuation

Goal: Reasonix reply/continue becomes closer to MiMo reply flow.

Tasks:

- Record `reasonix_session_path`.
- Add reply support using `chat --resume` or a confirmed session continuation mechanism.
- Ensure the GUI can see the same session when it shares Reasonix home.

Acceptance:

- Codex can send a follow-up to a Reasonix task.
- The same session record is discoverable by Reasonix GUI or Bridge session viewer.

### P6.5 GUI Session Sharing

Goal: GUI displays or opens TUI-created sessions without GUI automation.

Tasks:

- Confirm GUI reads `REASONIX_HOME` session/project stores.
- Add safe backend route to open Reasonix GUI or session folder.
- Optionally write/update GUI tab metadata only if Reasonix documents the format and it is safe.

Acceptance:

- User can inspect Reasonix task session from GUI or the folder.
- Bridge does not click GUI controls or steal focus.

### P6.6 Token/Cost Integration

Goal: Reasonix token reporting joins TokenBudget if real data exists.

Tasks:

- Parse token/cost data from Reasonix output/session JSONL if available.
- If unavailable, show `unknown` and keep MiMo real-token path unchanged.

Acceptance:

- TokenBudget never invents Reasonix numbers.
- UI distinguishes real, unknown, and unsupported.

## Test Plan

- `agent_list` shows MiMo and configured fake Reasonix.
- `mimo_*` tools still work unchanged.
- `agent_start_task` rejects unknown `agent_id`.
- Fake Reasonix runner can complete, fail, timeout, and be cancelled.
- Reasonix parser extracts visible text and tool summaries from fixture logs.
- Review Package includes `agent_summary`.
- Old tasks with `mimo_summary` render correctly.
- Disjoint MiMo/Reasonix fake tasks can run concurrently.
- Overlapping editable paths are queued or rejected.
- Reasonix session path mapping is bounded and cannot read arbitrary files.
- Admin UI folds tool calls and emphasizes agent replies for both MiMo and Reasonix.

## Open Questions

- Does Reasonix session JSONL contain stable task/session IDs and token/cost fields?
- What is the safest non-interactive permission mode for `reasonix run` under Bridge control?
- Can Reasonix GUI open a specific session path by command/deep link, or only by reading shared session metadata?
- Should Reasonix use a dedicated Bridge-managed `REASONIX_HOME` or the user's existing Reasonix home by default?

## Recommended First Implementation Slice

1. Implement P6.0 discovery/probe and document exact Reasonix session JSONL shape.
2. Add Agent Registry with MiMo only.
3. Add `agent_list`.
4. Add fake Reasonix adapter tests.
5. Add real `reasonix-tui` health probe.
6. Add one-shot `reasonix run` execution.
7. Add Reasonix parser/live viewer integration.
8. Add agent-aware queue only after one-shot execution is stable.
