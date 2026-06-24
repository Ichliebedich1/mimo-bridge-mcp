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

P6.0-P6.11 are partially implemented. The runtime now has an Agent Registry, Reasonix TUI probe, Reasonix one-shot runner, generic low-token task get/wait/reply tools, generic lifecycle tools for cancel/finish/merge/delete/queue, safe client Agent commands including replies, Reasonix session mapping through `agent_session_path`, a first Admin UI agent selector/badge/reply pass, an agent-aware queue that permits safe parallelism only for different agents editing non-overlapping paths, Reasonix live/session parsing for the read-only live viewer, safe local folder opening, and explicit Reasonix token/cost extraction when session fields exist. Existing `mimo_*` MCP tools remain compatible.

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
| Review package | MiMo summary/log/diff | Agent summary/log/diff | `agent_summary` added, `mimo_summary` kept for compatibility |
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

Status:

- Implemented for one-shot tasks.
- `agent_get_task` and `agent_wait_task` now reuse bounded Review Package behavior and optional `agent_id` mismatch checks.
- Reasonix one-shot runs persist `agent_session_path` when a session JSONL is found under configured `REASONIX_HOME\projects`.
- Controlled real Reasonix smoke succeeded with `max_steps=20`; `max_steps=5` was too low and caused a false failure.
- Admin UI task creation/agent selector and agent badges are implemented in the first UI slice.

### P6.4 Agent-Aware Queue

Goal: allow MiMo and Reasonix to work in parallel safely.

Tasks:

- Track active editable paths per agent.
- Allow disjoint tasks on different agents.
- Queue or reject overlapping tasks.
- Keep one write task per agent initially.

Acceptance:

- MiMo and Reasonix can run concurrently on different editable paths.
- Overlap is blocked or queued deterministically.

Status:

- Implemented as P6.4 first queue slice.
- `TaskQueue` stores `agentId`, `workspacePath`, and `editablePaths`.
- `globalTaskQueue` concurrency is 2 so a machine can run one MiMo task and one Reasonix task when safe.
- Same-agent tasks always queue, even when their paths differ.
- Different-agent tasks queue when editable paths overlap.
- Missing agent/workspace/path metadata is treated conservatively and queues instead of running in parallel.

### P6.5 Reasonix Session Continuation

Goal: Reasonix reply/continue becomes closer to MiMo reply flow.

Tasks:

- Record `reasonix_session_path`.
- Add reply support using `chat --resume` or a confirmed session continuation mechanism.
- Ensure the GUI can see the same session when it shares Reasonix home.

Acceptance:

- Codex can send a follow-up to a Reasonix task.
- The same session record is discoverable by Reasonix GUI or Bridge session viewer.

Status:

- Implemented for TUI resume.
- `agent_reply_task` is exposed through STDIO MCP, HTTP MCP, and REST `POST /api/agent-tasks/:id/replies`.
- Admin UI replies route to `/api/agent-tasks/:id/replies` for non-MiMo tasks.
- Reasonix TUI uses `reasonix run --resume <agent_session_path>`; the session file must exist under configured `REASONIX_HOME`.
- Follow-up runs advance `current_round`, refresh Review Package, and keep local session paths out of browser responses.

### P6.6 Reasonix Live / Session Parsing

Goal: Reasonix live viewer becomes useful in the same spirit as MiMo live viewer.

Tasks:

- Parse bounded tails of Reasonix session JSONL from `agent_session_path`.
- Show visible assistant replies as primary message events.
- Fold Reasonix tool calls and tool results into summarized tool events.
- Redact local paths, session ids, token/password/API-key patterns.
- Do not expose hidden reasoning fields such as `reasoning_content`.
- Merge Reasonix session events with Bridge runtime logs in `/api/tasks/:id/live`.

Acceptance:

- User can see what Reasonix visibly replied and which tools it used.
- Browser responses do not expose `agent_session_path`, full source, full diffs, full logs, or hidden reasoning.

Status:

- Implemented locally in `src/services/reasonix-event-parser.ts` and `apps/local-daemon/src/live-task-view.ts`.
- Covered by `tests/reasonix-event-parser.test.mjs`, `tests/live-task-view.test.mjs`, and `tests/admin-api.test.mjs`.

### P6.7 Safe Local Open / GUI Session Sharing First Slice

Goal: let the user inspect task/session folders from the Admin UI without exposing arbitrary local path opening.

Tasks:

- Add safe backend route to open task folder or Reasonix session folder.
- Resolve paths from stored task state only; never accept a raw path from the browser.
- Validate task folders against active Worktree roots or configured `allowedRoots`.
- Validate Reasonix session folders against configured `REASONIX_HOME`.
- Confirm GUI reads `REASONIX_HOME` session/project stores.
- Optionally write/update GUI tab metadata only if Reasonix documents the format and it is safe.

Acceptance:

- User can inspect Reasonix task session folder from Admin UI.
- Raw local paths are not returned to the browser.
- Bridge does not click GUI controls or steal focus.

Status:

- First safe local-open slice is implemented.
- Admin UI task detail includes "打开任务文件夹" and Reasonix-only "打开会话文件夹".
- REST route: `POST /api/tasks/:id/open` with `action=task_folder|session_folder`.
- Direct Reasonix GUI-to-specific-session opening remains future work until a stable command/deep link is confirmed.

### P6.8 Token/Cost Integration

Goal: Reasonix token reporting joins TokenBudget if real data exists.

Tasks:

- Parse token/cost data from Reasonix output/session JSONL if available.
- If unavailable, show `unknown` and keep MiMo real-token path unchanged.

Acceptance:

- TokenBudget never invents Reasonix numbers.
- UI distinguishes real, unknown, and unsupported.

Status:

- Implemented for explicit session JSONL token fields.
- `reasonix-event-parser` recognizes `tokens`, `usage`, `token_usage`, `prompt_tokens`, `completion_tokens`, `total_tokens`, and `cost`.
- `ReasonixTuiRunner` records usage only when `total_tokens > 0`; sessions without explicit usage fields remain unknown/no record.

### P6.9 Generic Agent Lifecycle Tools

Goal: Reasonix tasks should not need to borrow `mimo_*` tool names for normal lifecycle management.

Tasks:

- Add `agent_cancel_task`, `agent_finish_task`, `agent_merge_task`, `agent_delete_task`, and `agent_queue_status`.
- Register those tools in STDIO MCP and HTTP MCP.
- Add REST routes under `/api/agent-tasks/:id` for cancel, finish, worktree merge/discard, and delete.
- Add `GET /api/agent-queue` with optional `agent_id` filtering.
- Keep existing `mimo_*` tools unchanged for compatibility.
- Reject mismatched `agent_id` before mutating task state.

Acceptance:

- Codex can manage Reasonix task lifecycle through `agent_*` tools.
- A task cannot be accidentally cancelled/accepted/deleted through the wrong `agent_id`.
- Queue status can be filtered by agent without exposing full task logs or source.

Status:

- Implemented locally.
- Verified with root/local-daemon/admin-ui builds.
- Focused tests: `node --test tests\agent-lifecycle-task.test.mjs tests\agent-get-wait-task.test.mjs tests\admin-api.test.mjs tests\stdio-protocol.test.mjs` passed 43/43.
- P6 regression: `node --test tests\agent-start-task.test.mjs tests\agent-reply-task.test.mjs tests\task-queue.test.mjs tests\reasonix-event-parser.test.mjs tests\live-task-view.test.mjs tests\token-budget.test.mjs` passed 75/75. Windows node-pty `AttachConsole failed` output is known noise when exit code is 0.

### P6.10 Safe Client Agent Commands

Goal: third-party agents and scripts should call Reasonix/generic Agent paths without fragile shell JSON or MiMo-specific command names.

Tasks:

- Extend `scripts/mimo-bridge-client.mjs` with `agent-*` commands.
- Keep existing MiMo commands unchanged.
- Use REST for `agent-list`, `agent-start`, `agent-review`, lifecycle actions, and `agent-queue`.
- Use MCP SDK only for `agent_wait_task`, with request timeout greater than `timeout_seconds`.
- Preserve UTF-8 JSON file/stdin behavior and the thin PowerShell wrapper.

Acceptance:

- Scripted callers can start, wait, review, finish, merge/discard, delete, and inspect Reasonix tasks using the safe client.
- No caller needs inline PowerShell or inline Node JSON for Reasonix delegation.
- Output remains compact JSON with bounded review data.

Status:

- Implemented locally.
- `node --test tests\mimo-bridge-client.test.mjs` passed 24/24.
- Combined focused regression `node --test tests\mimo-bridge-client.test.mjs tests\agent-lifecycle-task.test.mjs tests\agent-get-wait-task.test.mjs tests\admin-api.test.mjs tests\stdio-protocol.test.mjs` passed 67/67 after root/local-daemon/admin-ui builds.

### P6.11 Safe Client Reply Commands

Goal: scripted follow-up messages should be as safe as task creation.

Tasks:

- Add `reply` for MiMo task replies.
- Add `agent-reply` for Reasonix/generic Agent task replies.
- Accept `--message` for short messages and UTF-8 JSON file/stdin for long Chinese or multiline messages.
- Keep PowerShell wrapper thin and JSON-free.

Acceptance:

- Scripted callers can continue MiMo and Reasonix tasks without inline shell JSON.
- Follow-up messages preserve Chinese text and newlines.

Status:

- Implemented locally.
- `node --test tests\mimo-bridge-client.test.mjs` passed 26/26.
- Combined focused regression `node --test tests\mimo-bridge-client.test.mjs tests\agent-reply-task.test.mjs tests\agent-lifecycle-task.test.mjs tests\admin-api.test.mjs tests\stdio-protocol.test.mjs` passed 67/67 after root/local-daemon/admin-ui builds.

### P6.12 Bounded Agent Task Listing

Goal: Codex and third-party agents need a small task index for Reasonix/MiMo without falling back to full task details, logs, source, or diffs.

Tasks:

- Add MCP `agent_list_tasks`.
- Add REST `GET /api/agent-tasks?agent_id=...&limit=...`.
- Add safe client command `agent-tasks` / `agent-list-tasks`.
- Return only bounded task summaries: task id, agent, status, objective, sanitized/truncated summary, modified file count, risk flags, review recommendation, timestamps, round, Worktree state, and safe-delete metadata.
- Sanitize local paths, session identifiers, stdin labels, token-like strings, API keys, authorization values, and passwords from summaries.

Acceptance:

- Listing recent Reasonix tasks does not expose full logs, full diff, source files, raw log paths, or raw local paths.
- `agent_id` filtering works.
- Safe-delete metadata is included so UI/agents can tell which terminal tasks are safe to remove.

Status:

- Implemented and deployed locally.
- Verified with `npm.cmd run build`, `npm.cmd --prefix apps\local-daemon run build`, `npm.cmd --prefix apps\admin-ui run build`.
- Focused tests passed: `node --test tests\agent-list-tasks.test.mjs tests\mimo-bridge-client.test.mjs tests\admin-api.test.mjs tests\stdio-protocol.test.mjs` 65/65.
- Live smoke after daemon restart passed: `agent-list`, `agent-queue --agent-id reasonix-tui`, and `agent-tasks --agent-id reasonix-tui --limit 5`.

### P6.13 Generic Agent Pending-Review Recovery

Goal: Reasonix should have the same "Codex missed the completion, recover later" path that MiMo has.

Tasks:

- Add MCP `agent_pending_reviews`.
- Add REST `GET /api/agent-pending-reviews?agent_id=...&limit=...&max_chars=...`.
- Add safe client command `agent-recover` / `agent-pending-reviews`.
- Extend pending-review summaries with `agent`.
- Generate `agent-review --agent-id <agent>` commands for non-MiMo tasks while keeping existing MiMo `review --task-id` commands.
- Keep output bounded and free of full logs, full diffs, source files, raw log paths, and raw local paths.

Acceptance:

- Codex can recover completed Reasonix tasks after an interrupted wait.
- `agent_id` filtering works.
- The next review command points to the correct generic Agent review command.

Status:

- Implemented and deployed locally.
- Verified with root/local-daemon/admin-ui builds.
- Focused tests passed: `node --test tests\pending-reviews.test.mjs tests\mimo-bridge-client.test.mjs tests\admin-api.test.mjs tests\stdio-protocol.test.mjs` 65/65.
- Live smoke after daemon restart passed: `agent-recover --agent-id reasonix-tui --limit 5 --max-chars 8000`.

## Test Plan

- `agent_list` shows MiMo and configured fake Reasonix.
- `mimo_*` tools still work unchanged.
- `agent_start_task` rejects unknown `agent_id`.
- Fake Reasonix runner can complete, fail, timeout, and be cancelled.
- Reasonix parser extracts visible text and tool summaries from fixture logs/session JSONL.
- Review Package includes `agent_summary` and legacy `mimo_summary`.
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
7. Add Reasonix parser/live viewer integration. Completed as P6.6.
8. Next: direct GUI shared-session opening if stable Reasonix support exists, or migrate MiMo internals toward the generic `agent_*` layer while preserving `mimo_*` compatibility.
