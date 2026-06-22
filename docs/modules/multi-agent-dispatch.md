# Multi-Agent Dispatch

## Module Goal

Let Codex assign work to multiple local coding agents, starting with MiMo and Reasonix, while preserving bounded review, Worktree isolation, and low-token waiting.

## Task Goal

P6 changes the system from "one configured execution provider" to "many registered agents." Codex should be able to run one task on MiMo and another task on Reasonix without restarting the daemon or switching global configuration.

## Current Status

Planned. The current implementation is MiMo-first: tasks, tools, config, UI labels, and runner naming still assume MiMo as the execution agent. The architecture should evolve without breaking the existing `mimo_*` MCP tools.

## Target Agents

- `mimo`: existing MiMo Code PTY runner. Must remain supported and backward compatible.
- `reasonix-tui`: first Reasonix execution target if it exposes a terminal/TUI workflow compatible with PTY.
- `reasonix-gui`: later target. Treat as experimental until it has a stable automation surface.

## Core Design

Add an Agent Registry owned by the local daemon:

```text
Codex / Admin UI
  -> generic agent_* MCP/REST tools
  -> Agent Registry
     -> MiMo runner adapter
     -> Reasonix TUI runner adapter
     -> Reasonix GUI adapter, only after capability probe
  -> Task store / Worktree / Review Package / Queue scheduler
```

Every new task should carry:

- `agent_id`
- `agent_name`
- `agent_kind`: `pty`, `api`, `gui`, or `manual-assisted`
- `objective`
- `editable_paths`
- `readonly_paths`
- task Worktree metadata
- review package metadata

Keep old fields such as `mimo_summary` for compatibility, but introduce generic fields such as `agent_summary`.

## Tool Plan

Keep existing tools:

- `mimo_start_task`
- `mimo_get_task`
- `mimo_wait_task`
- `mimo_reply_task`
- `mimo_cancel_task`
- `mimo_finish_task`
- `mimo_list_tasks`
- `mimo_merge_task`
- `mimo_queue_status`
- `mimo_token_status`
- `mimo_delete_task`

Add generic tools:

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

The old `mimo_*` tools can internally call the generic tools with `agent_id="mimo"`.

## Scheduling Rules

First implementation should be conservative:

- Allow concurrent tasks on different agents only when editable path sets do not overlap.
- If editable paths overlap, queue the later task.
- Keep one write task per agent until the runner behavior is proven safe.
- Read-only review and status calls can run concurrently.
- Merge/discard remains a Codex decision; no agent merges its own Worktree.

This avoids the obvious footgun: two agents editing the same files while Codex thinks they are independent.

## Reasonix TUI Plan

Reasonix TUI is the likely first real adapter because it may fit the current PTY runner model.

Needed discovery:

- executable path
- launch arguments
- working directory behavior
- prompt input method
- completion signal
- structured or parseable output
- continuation/reply behavior
- cancellation behavior
- whether it supports non-interactive mode

If output is not compatible with MiMo event parsing, create a Reasonix-specific parser behind the same `AgentRunner` interface.

## Reasonix GUI Plan

Reasonix GUI should not be treated as a stable execution runner until proven. First build a capability probe:

- Can it be launched with project/workspace arguments?
- Can it receive a task through CLI/API/IPC/plugin/deep link?
- Can completion, failure, and waiting-for-user states be observed?
- Can logs or result summaries be read without screen scraping?
- Can it run without stealing focus?
- Can it be safely cancelled?

If no stable interface exists, GUI support should be limited to "open Reasonix with task context" or "manual-assisted" mode. Avoid relying on brittle click automation for core task execution.

## Required Code Changes

- `src/services/mimo-runner.ts`: extract an `AgentRunner` interface and keep MiMo as one adapter.
- `src/services/task-queue.ts`: add agent-aware and path-conflict-aware scheduling.
- `src/services/task-store.ts`: persist `agent_id`, `agent_name`, and generic summary fields.
- `src/types.ts`: add generic agent task fields while keeping MiMo compatibility fields.
- `src/tools/*`: add generic `agent_*` tools and route `mimo_*` through `agent_id="mimo"`.
- `apps/local-daemon/src/tool-context.ts`: create and register multiple agent adapters.
- `apps/local-daemon/src/mcp.ts`: expose `agent_*` tools.
- `apps/local-daemon/src/daemon-config.ts`: support multiple configured agents.
- `apps/local-daemon/src/launcher-cli.ts`: first-run setup should configure MiMo and Reasonix independently.
- `apps/admin-ui/src/App.tsx`: show available agents, per-agent status, and agent selection at task creation.

## Admin UI Requirements

The UI should show:

- agent list: configured, missing config, running, error
- task agent badge
- per-agent queue/running state
- task creation agent selector
- clear warning when selected editable paths overlap an active task
- Reasonix GUI marked experimental until capability probe passes

## Test Plan

- Agent Registry lists MiMo and fake Reasonix adapters.
- `agent_start_task` requires a valid `agent_id`.
- `mimo_start_task` still works by routing to `agent_id="mimo"`.
- two tasks on different agents and disjoint editable paths can run concurrently.
- overlapping editable paths are queued or rejected according to scheduler policy.
- Review Package works with generic `agent_summary`.
- old tasks with only `mimo_summary` still render and review correctly.
- Reasonix GUI capability probe reports unavailable/experimental without crashing.

## Open Questions

- What are the installed paths for Reasonix TUI and Reasonix GUI on this machine?
- Does Reasonix TUI provide structured output or only human text?
- Does Reasonix GUI expose API, IPC, plugin hooks, deep links, or logs?
- Should Codex decide the target agent manually, or should the daemon later suggest an agent based on task type?

## Recommended First Implementation Slice

1. Add `docs/modules/multi-agent-dispatch.md` and update module map/decisions.
2. Add config schema for `agents[]`, without changing runtime behavior.
3. Add `agent_list`.
4. Wrap MiMo as `agent_id="mimo"` internally while preserving all existing tests.
5. Add fake Reasonix adapter tests before touching real Reasonix.
6. Probe Reasonix TUI and GUI capabilities locally.
