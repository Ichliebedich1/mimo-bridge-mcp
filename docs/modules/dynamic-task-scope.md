# Dynamic Task Scope

## Module Goal

Make each delegated agent task carry its own explicit, reviewable safety boundary instead of relying on one fixed handwritten editable-path list.

This is P5.5. It keeps the existing two-layer safety model:

Current status: implemented and merged at `0497211 merge: accept dynamic task scope`. Future agent adapters, including Reasonix, must reuse this mechanism instead of creating a separate safety-boundary system.

- Global machine boundary: `allowedRoots` says which project roots this computer allows Bridge-managed agents to enter.
- Per-task boundary: `editable_paths` and `readonly_paths` say what the current task may edit or read as reference.

The global boundary must remain a hard upper limit. The per-task boundary should become dynamic and task-specific.

## Plain-Language Explanation

`allowedRoots` is like saying: "Agents may only enter these buildings."

`editable_paths` is like saying: "For this job, the agent may only work in these rooms."

The optimization is not to remove the building gate. The optimization is to stop reusing one fixed room list for every job. Codex should generate a fresh room list each time it delegates a task.

## User Decisions

- Tests boundary: when Codex creates a coding task, tests should not always be blindly editable. Default behavior should be:
  - Include likely test paths when the task asks for behavior changes, bug fixes, UI behavior, API behavior, or regression coverage.
  - Keep tests read-only or omitted for documentation-only, release-note-only, or investigation-only tasks.
  - Allow Codex or the admin UI to manually add tests before dispatch.
- Repo-wide editing is allowed to exist, but it must be explicit and confirmed. It must never be the default.
- Reasonix must reuse this same `TaskScopePolicy` mechanism in P6. MiMo and Reasonix should not have separate safety boundary rules.

## Scope Modes

| Mode | Purpose | Default | Behavior |
| --- | --- | --- | --- |
| `strict` | Normal coding tasks | Yes | Agent may only modify explicit effective editable paths. Out-of-scope changes are review failures. |
| `suggested` | Uncertain tasks | No | Agent may work in explicit paths and may request scope expansion in the summary, but must not modify outside scope. |
| `repo-wide` | Broad refactors or cleanup | No | Entire repository can be editable only after explicit user/Codex confirmation. |

## Proposed Data Model

Add a task scope snapshot to persisted task state:

```ts
interface TaskScope {
  mode: "strict" | "suggested" | "repo-wide";
  source: "codex" | "admin-ui" | "client" | "manual";
  workspace_path: string;
  effective_editable_paths: string[];
  effective_readonly_paths: string[];
  requested_editable_paths: string[];
  requested_readonly_paths: string[];
  include_tests: "auto" | "always" | "never";
  repo_wide_confirmed: boolean;
  generated_at: string;
}
```

Keep current `config.editable_paths` and `config.readonly_paths` for compatibility. Populate them from `TaskScope.effective_*` until all older code is migrated.

## TaskScopePolicy

Add `src/services/task-scope.ts`.

Responsibilities:

1. Validate that the workspace is inside `allowedRoots`.
2. Normalize requested relative paths.
3. Reject `..`, absolute paths, symlink escapes, and paths outside the workspace.
4. Generate effective editable/read-only paths from task input.
5. Optionally add likely test paths when `include_tests="auto"` and the task type makes tests relevant.
6. Require `repo_wide_confirmed=true` for `repo-wide`.
7. Produce a scope report for Review Package and admin UI.

## Review Package Changes

Add `scope_report`:

```ts
interface ScopeReport {
  mode: string;
  source: string;
  effective_editable_paths: string[];
  effective_readonly_paths: string[];
  changed_files_inside_scope: string[];
  changed_files_outside_scope: string[];
  has_out_of_scope_changes: boolean;
  repo_wide_confirmed: boolean;
}
```

Rules:

- If any changed file is outside the effective editable scope, add `OUT_OF_SCOPE_CHANGES` to `risk_flags`.
- `OUT_OF_SCOPE_CHANGES` should make `review_recommendation` become `reject`.
- Existing Worktree out-of-bounds checks must continue to work.
- `repo-wide` should still show the broad scope in Review Package so Codex knows why many files changed.

## Admin UI Changes

Task creation should show a "this task can modify" preview before submit.

Required fields:

- Scope mode selector: default `strict`.
- Include tests selector: default `auto`.
- Editable path list.
- Read-only path list.
- Repo-wide confirmation checkbox, only visible when `repo-wide` is selected.

The UI should explain:

- Global allowed roots are machine configuration.
- This task's editable paths are the live safety boundary.
- MiMo/Reasonix may request more scope but must not self-expand it.

## Prompt Changes

The task brief must include:

- Scope mode.
- Effective editable paths.
- Effective read-only paths.
- Clear warning that out-of-scope edits will be rejected.
- In `suggested` mode, instruction to ask for scope expansion in the completion summary instead of editing outside scope.

## Safe Client Changes

Update `scripts/mimo-bridge-client.mjs` and `.ps1` documentation to accept the new JSON fields:

- `scope_mode`
- `include_tests`
- `repo_wide_confirmed`
- `editable_paths`
- `readonly_paths`

The client must keep reading UTF-8 JSON from a file or stdin. Do not reintroduce inline shell JSON.

## P6 Reuse

Reasonix must use the same scope model:

- `agent_start_task(agent_id="mimo")` and `agent_start_task(agent_id="reasonix-tui")` should both pass through `TaskScopePolicy`.
- Agent-aware queue conflict checks should use `TaskScope.effective_editable_paths`.
- Review Package scope reporting should be agent-neutral.

## Test Plan

- Default task uses `strict`.
- Explicit editable paths are normalized and persisted into the task scope snapshot.
- Invalid paths with `..`, absolute paths, or symlink escapes are rejected.
- `repo-wide` without confirmation is rejected.
- `repo-wide` with confirmation is accepted and clearly reported.
- Behavior/API tasks with `include_tests="auto"` include likely test paths when present.
- Documentation-only tasks with `include_tests="auto"` do not automatically add tests.
- Changed files outside effective editable scope add `OUT_OF_SCOPE_CHANGES`.
- Review recommendation becomes `reject` for out-of-scope changes.
- Review Package includes `scope_report` without returning full diff or full source.
- Admin API accepts and validates new scope fields.
- Admin UI renders the scope preview and repo-wide confirmation.
- Existing `mimo_*` tools continue working when scope fields are omitted.

## Implementation Order

1. Add task scope types while keeping existing fields compatible.
2. Add `TaskScopePolicy` validation and normalization.
3. Wire `mimo_start_task` and REST `/api/tasks` through the policy.
4. Update task brief generation.
5. Add `scope_report` to Review Package.
6. Update admin UI task creation.
7. Update safe client docs/tests.
8. Add regression tests.
9. Rebuild and run focused tests.

## Acceptance Criteria

- Codex can delegate each task with a different editable boundary.
- Global `allowedRoots` still blocks unauthorized project roots.
- MiMo cannot silently expand its own write boundary.
- Repo-wide tasks are possible but require explicit confirmation.
- Review Package clearly shows whether changes stayed inside the task boundary.
- Reasonix P6 can reuse the same boundary mechanism without a separate design.
