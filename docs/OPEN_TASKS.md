# Open Tasks

## Pending

- Repair P4 so a second write task remains queued until the active MiMo runner actually completes.
- Prevent duplicate queued replies for the same task/session.
- Clean up queued Worktrees when a queued task is cancelled.

## Completed

- P4.5 Review Package generation and persistence.
- Bounded `summary`, `review`, `diff`, `focused`, `logs`, and explicit `full` modes.
- Risk flags for out-of-bounds changes and failed tests.
- Workspace path guard for focused evidence.

## Risks

- P4 tests currently assert the returned `queued` label but do not prove the second runner stayed stopped.
- The known P2 Runner integration test remains excluded because it hangs.

## Next Steps

1. Fix P4 with a completion Promise tied to the real MiMo callback.
2. Add a regression asserting runner invocation count remains one while another write task is active.
3. Perform one supervised real MiMo review using the default Review Package flow.
