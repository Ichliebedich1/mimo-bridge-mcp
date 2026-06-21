# Task Lifecycle

## Module Goal

Persist and control start, get, reply, cancel, finish, and list operations.

## Current Status

Implemented and exposed through the shared daemon's MCP and fixed REST routes.

## Entry Files

- `src/services/task-store.ts`
- `src/tools/start-task.ts`
- `src/tools/get-task.ts`
- `src/tools/reply-task.ts`
- `src/tools/cancel-task.ts`
- `src/tools/finish-task.ts`
- `src/tools/list-tasks.ts`

## Dependencies

Runner/parser, queue, Worktree manager, and Review Package.

## Collaboration Needed

Launcher/distribution must preserve the shared runtime directory and must not create a second daemon state.

## Pending Work

Audit cancellation cleanup for an active Worktree task.

## Test Method

Run lifecycle, max-rounds, cancel, and normal regression tests from `AGENTS.md`.
