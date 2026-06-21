# P4.5 Token Budget Review

## Module Goal

Keep Codex review context small while preserving a controlled path to deeper evidence.

## Current Status

Implemented. `mimo_get_task` defaults to `review`, completed MiMo callbacks persist a Review Package, and every escalation mode is bounded.

## Public Interface

`mimo_get_task` accepts:

- `detail_level`: `summary | review | diff | focused | logs | full`
- `max_chars`: default `8000`, allowed `1000-100000`; `full` requires at least `4000`
- `log_tail_lines`: default `20`, maximum `200`
- `include_diff`, `include_logs`, `include_files`
- `file_paths`, `diff_paths`: maximum 20 explicit workspace-relative paths

## Review Package

The package contains task status, objective, editable paths, Git-derived changed files and line counts, diff stat, out-of-bounds report, test result, exit code, bounded log tail, MiMo summary, risk flags, generation time, and recommendation.

Risk flags currently include:

- `OUT_OF_BOUNDS_CHANGES`
- `TESTS_FAILED`
- `TASK_FAILED`
- `NON_ZERO_EXIT`
- `TASK_ERROR`
- `ISSUES_REPORTED`
- `REVIEW_DATA_UNAVAILABLE`
- `NO_CHANGES_AND_NO_TESTS`

## Mandatory Review Flow

1. Request `review`.
2. Verify `editable_paths` against `changed_files`.
3. Check out-of-bounds report, diff stat, line summary, test result, and risk flags.
4. Merge directly only when evidence is sufficient and no risk requires escalation.
5. Escalate to path-filtered `diff`, `focused`, or bounded `logs` only for the flagged area.
6. Use `full` only for explicit debugging. It remains bounded and never means “read the repository.”

## Security And Budget Rules

- Default responses never expose full diff, raw logs, stderr logs, or file contents.
- Focused paths reject traversal, outside absolute paths, and symlink escape.
- Git diff uses a bounded child-process buffer and returns truncation metadata.
- Log tail reads from the end of the file instead of loading the complete log.
- Review Package is structurally reduced to fit `max_chars` while retaining risk and recommendation fields.

## Entry Files

- `src/services/review-package.ts`
- `src/tools/get-task.ts`
- `src/types.ts`
- `tests/review-package.test.mjs`

## Test Method

- `npm.cmd run build`
- `node --test tests/review-package.test.mjs tests/stdio-protocol.test.mjs`
- Run the normal regression command from `AGENTS.md`.
