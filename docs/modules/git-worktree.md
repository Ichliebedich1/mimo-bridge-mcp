# Git Worktree Isolation

## Module Goal

Isolate MiMo code changes, audit path boundaries, and let Codex merge or discard.

## Current Status

Implemented. Changed files, diff summaries, and out-of-bounds paths feed the Review Package.

## Entry Files

- `src/services/git-worktree.ts`
- `src/tools/merge-task.ts`

## Public Interfaces

Create, inspect, merge, discard, and remove a task Worktree.

## Dependencies

Git, task lifecycle, path guard, and Review Package.

## Collaboration Needed

Launcher portability must not migrate active Worktrees between devices.

## Pending Work

Audit cleanup after cancellation of an active Worktree task.

## Test Method

`node --test tests/git-worktree.test.mjs tests/p3-handlers.test.mjs`.
