# Runner And Parser

## Module Goal

Run MiMo through a Windows PTY and turn JSON events into task completion data.

## Current Status

Implemented and committed. Intermediate `step_finish(reason="tool-calls")` events now continue execution; terminal steps such as `stop` complete the task.

## Entry Files

- `src/services/mimo-runner.ts`
- `src/services/event-parser.ts`
- `src/types.ts`

## Public Interfaces

- `runMimoTask()`
- `createEventParser()`
- `isTerminalMimoEvent()`

## Dependencies

MiMo CLI, `node-pty`, task lifecycle, and Windows process-tree cleanup.

## Collaboration Needed

Task queue completion must follow the real Runner callback. Review generation consumes the persisted result.

## Pending Work

Tracked Windows Runner integration hang and PTY warning noise.

## Test Method

`npm.cmd run build`; `node --test tests/event-parser.test.mjs`; then the normal regression from `AGENTS.md`.
