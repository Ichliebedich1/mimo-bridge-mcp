# Task Queue

## Module Goal

Serialize MiMo write tasks while allowing bounded read-only status queries.

## Current Status

Implemented. Start and reply share one queue; queue occupancy follows real Runner completion, failure, or cancellation.

## Entry Files

- `src/services/task-queue.ts`
- `src/services/running-tasks.ts`
- `src/tools/start-task.ts`
- `src/tools/reply-task.ts`
- `src/tools/cancel-task.ts`

## Dependencies

Task lifecycle, Runner callbacks, and Worktree cleanup.

## Collaboration Needed

The launcher must check health and reuse the current queue rather than starting duplicate daemons.

## Pending Work

Keep duplicate queued-reply and cancellation-release coverage during lifecycle changes.

## Test Method

`node --test tests/task-queue.test.mjs tests/concurrent-reject.test.mjs`.
