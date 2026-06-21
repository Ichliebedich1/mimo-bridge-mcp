# Safe Task Deletion

## Module Goal

Permanently delete obsolete terminal tasks and their runtime artifacts without losing active work.

## Current Status

Implemented in P5.1 and committed in `c909016`.

## Entry Files

- `src/tools/delete-task.ts`
- `apps/local-daemon/src/admin-api.ts`
- `apps/admin-ui/src/App.tsx`

## Public Interfaces

- `mimo_delete_task`
- `DELETE /api/tasks/:id`

## Dependencies

Task store, running registry, queue, and Worktree state.

## Collaboration Needed

Launcher uninstall must not call task deletion implicitly and must ask before removing user runtime data.

## Pending Work

None for first-version scope.

## Test Method

Run admin API and deletion tests; verify active or Worktree-backed tasks are rejected.
