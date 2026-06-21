# Open Tasks

## Pending

- Commit the current Runner terminal-event fix, no-change review risk, tests, and handover docs.
- Verify the shared local daemon remains available across Codex turns and formalize the supported background startup path.
- Replace machine-specific startup paths with persisted local configuration and first-run discovery.
- Add a Windows one-click launcher with start/stop/restart/open/log/status controls and optional logon startup.
- Add a read-only task live-run viewer; show bounded recent events/log tails without interactive terminal input or interruption controls.
- Build a Windows 10 x64 portable ZIP and installer; bundle the Node runtime but require MiMo re-authentication on each device.
- Connect `TokenBudgetManager` to real MiMo token events.
- Audit cleanup and discard behavior when an active Worktree task is cancelled.

## Completed

- P4.5 Review Package generation and persistence.
- Bounded `summary`, `review`, `diff`, `focused`, `logs`, and explicit `full` modes.
- Risk flags for out-of-bounds changes and failed tests.
- Workspace path guard for focused evidence.
- P4 Runner-bound write serialization.
- Duplicate queued reply rejection.
- Queued Worktree cleanup on cancellation.
- Runner ignores intermediate `step_finish(reason="tool-calls")` events and waits for the terminal step.
- Coding tasks with no changes and no reported tests receive `NO_CHANGES_AND_NO_TESTS`.
- Real MiMo smoke completed read, edit, verification read, and final stop.
- P5.2/P5.3 one-click startup and portability approach documented.

## Risks

- The known P2 Runner integration test remains excluded because it hangs.
- The daemon is currently healthy, but persistence across Codex turns has not been verified.
- The current startup script is tied to this machine and rebuilds on every launch.
- `node-pty` is a native dependency, so portable artifacts must be built and tested for the target Windows architecture.
- MiMo authentication, active task state, and Worktrees must not be silently copied between devices.

## Next Steps

1. Commit the current uncommitted fix as a baseline.
2. Implement configuration discovery and production startup without rebuilds.
3. Add the one-click launcher and optional logon startup.
4. Validate a portable package on a clean Windows x64 environment.
5. Perform one supervised UI -> MiMo -> Review Package -> Codex -> merge workflow.
