# Open Tasks

## Pending

- Make the shared local daemon remain available across Codex turns and verify the supported startup path.
- Connect `TokenBudgetManager` to real MiMo token events.
- Flag a coding task as risky when it reaches review with no changed files and no reported tests.
- Audit cleanup and discard behavior when an active Worktree task is cancelled.

## Completed

- P4.5 Review Package generation and persistence.
- Bounded `summary`, `review`, `diff`, `focused`, `logs`, and explicit `full` modes.
- Risk flags for out-of-bounds changes and failed tests.
- Workspace path guard for focused evidence.
- P4 Runner-bound write serialization.
- Duplicate queued reply rejection.
- Queued Worktree cleanup on cancellation.

## Risks

- The known P2 Runner integration test remains excluded because it hangs.
- A no-change MiMo coding task can currently receive `review_recommendation=approve` when tests are not reported.
- The daemon passed startup smoke after P4 but was offline at the later handoff check.

## Next Steps

1. Start the shared daemon through `apps/local-daemon/start-local.ps1` and verify it remains online across turns.
2. Restart the Codex MCP connection and perform one supervised real MiMo coding task.
3. Add the no-change review risk flag, then connect real token usage events.
