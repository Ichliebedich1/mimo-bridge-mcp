# Reliability Tests

## Module Goal

Protect MCP protocol, task lifecycle, concurrency, Worktree, review, and UI/daemon behavior.

## Current Status

Normal regression is 176/176 passing. `tests/runner-integration.test.mjs` remains excluded because it hangs on Windows.

## Entry Files

- `tests/`
- `AGENTS.md`

## Dependencies

All runtime modules and the fake MiMo fixture.

## Collaboration Needed

P5.2/P5.3 must add launcher, reboot/logon, clean-machine, port-conflict, and portable-package tests.

## Pending Work

Repair or replace the excluded Runner integration test and reduce PTY warning noise.

## Test Method

Use the exact normal regression command documented in `AGENTS.md`.
