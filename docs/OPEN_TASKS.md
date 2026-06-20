# Open Tasks

## Pending

- Connect `TokenBudgetManager` to real MiMo token events.
- Flag a coding task as risky when it reaches review with no changed files and no reported tests.

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

## Next Steps

1. Restart the shared daemon and Codex connection so the repaired queue is loaded.
2. Perform one supervised real MiMo coding task using the default Review Package flow.
3. Add the no-change review risk flag, then connect real token usage events.
