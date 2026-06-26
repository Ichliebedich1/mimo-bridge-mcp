# Good First Issues

These are issue drafts for contributors. Each one should still be reviewed and adjusted before opening as a GitHub issue.

## 1. Add Architecture Diagram To README

- **Type:** Documentation
- **Difficulty:** Beginner
- **Background:** The README has a Mermaid architecture diagram. A contributor could improve it with a clearer visual flow or add an exported image for platforms that do not render Mermaid.
- **Expected outcome:** README architecture section is easier to understand in under 30 seconds.
- **Files likely involved:** `README.md`, optionally `docs/ARCHITECTURE.md`.
- **Notes for contributors:** Keep the core message: Codex plans/reviews, MiMo or Reasonix executes in isolated Git Worktrees, and the final decision stays with Codex or the user.

## 2. Add Chinese README Screenshots

- **Type:** Documentation
- **Difficulty:** Beginner
- **Background:** Chinese users are important for this project. Screenshots can make setup and Admin UI usage easier.
- **Expected outcome:** `README_zh-CN.md` includes useful screenshots or links to screenshot docs.
- **Files likely involved:** `README_zh-CN.md`, `docs/`, image assets if added.
- **Notes for contributors:** Redact usernames, private paths, tokens, and local project names.

## 3. Test Portable ZIP On Clean Windows 10

- **Type:** Release validation
- **Difficulty:** Beginner
- **Background:** The portable package needs clean-machine validation.
- **Expected outcome:** A report showing whether the portable ZIP starts without system Node and can open the Admin UI.
- **Files likely involved:** `docs/RELEASE_VALIDATION.md`, `docs/OPEN_TASKS.md`.
- **Notes for contributors:** Use a clean Windows 10 x64 VM if possible. Do not upload private logs.

## 4. Test Installer On Clean Windows 11

- **Type:** Release validation
- **Difficulty:** Beginner
- **Background:** The EXE installer has local smoke testing but needs independent clean Windows 11 validation.
- **Expected outcome:** A validation report covering install, launch, Admin UI, MCP endpoint, and uninstall behavior.
- **Files likely involved:** `docs/RELEASE_VALIDATION.md`, `docs/OPEN_TASKS.md`.
- **Notes for contributors:** Include Windows version and artifact name. Redact user paths.

## 5. Add Codex MCP Config Examples

- **Type:** Documentation
- **Difficulty:** Beginner
- **Background:** New users need clear examples for pointing Codex at `http://127.0.0.1:3210/mcp`.
- **Expected outcome:** A small doc section or new file with Codex MCP configuration examples.
- **Files likely involved:** `README.md`, `README_zh-CN.md`, `docs/`.
- **Notes for contributors:** Avoid undocumented config claims. Mark examples as version-specific if needed.

## 6. Add Claude Code MCP Config Examples If Applicable

- **Type:** Documentation
- **Difficulty:** Beginner / Intermediate
- **Background:** Some users may want to understand whether Claude Code can connect to the same MCP endpoint.
- **Expected outcome:** Clear documentation explaining supported or unsupported Claude Code MCP configuration.
- **Files likely involved:** `README.md`, `docs/`.
- **Notes for contributors:** Do not imply support that has not been tested.

## 7. Improve Troubleshooting For Port 3210 Conflicts

- **Type:** Documentation
- **Difficulty:** Beginner
- **Background:** Port conflicts are common on local daemon tools.
- **Expected outcome:** `docs/TROUBLESHOOTING.md` includes clearer detection and recovery steps for port `3210`.
- **Files likely involved:** `docs/TROUBLESHOOTING.md`.
- **Notes for contributors:** Keep commands Windows PowerShell friendly.

## 8. Improve Agent Runner Timeout Handling

- **Type:** Reliability
- **Difficulty:** Intermediate
- **Background:** Runner stability and timeout behavior are important for safe task delegation. MiMo and Reasonix should both fail clearly when a task stalls or hits a step/time limit.
- **Expected outcome:** Better timeout behavior, clearer failure reporting, or tests around runner timeouts.
- **Files likely involved:** `src/services/mimo-runner.ts`, `src/services/reasonix-tui-runner.ts`, `src/tools/wait-task.ts`, tests.
- **Notes for contributors:** Open an issue before implementation. This touches runtime behavior.

## 9. Add Admin UI Screenshots

- **Type:** Documentation
- **Difficulty:** Beginner
- **Background:** The Admin UI is part of the first-run experience but not yet visually documented.
- **Expected outcome:** README or docs include screenshots showing daemon status, task list, and review view.
- **Files likely involved:** `README.md`, `README_zh-CN.md`, `docs/`.
- **Notes for contributors:** Redact all local paths and task content.

## 10. Add Demo GIF

- **Type:** Documentation / demo
- **Difficulty:** Beginner
- **Background:** A 30-second GIF can make the workflow easier to share.
- **Expected outcome:** A short GIF following `docs/DEMO_SCRIPT.md`.
- **Files likely involved:** `docs/DEMO_SCRIPT.md`, README docs, demo assets.
- **Notes for contributors:** Keep the demo small and avoid private repositories.

## 11. Document Low-Token Review Workflow With Examples

- **Type:** Documentation
- **Difficulty:** Beginner / Intermediate
- **Background:** The low-token workflow is the project's core value.
- **Expected outcome:** Add a concrete example showing review-first escalation from summary to focused diff.
- **Files likely involved:** `README.md`, `README_zh-CN.md`, `docs/modules/low-token-wait.md`, `docs/modules/token-budget-review.md`.
- **Notes for contributors:** Do not recommend full-repo reads, full logs, or full diffs as defaults.

## 12. Add Common Failure Cases And Recovery Steps

- **Type:** Documentation
- **Difficulty:** Beginner
- **Background:** Early alpha users need help recovering from common setup and runner failures.
- **Expected outcome:** Troubleshooting covers common failure cases with safe recovery steps.
- **Files likely involved:** `docs/TROUBLESHOOTING.md`.
- **Notes for contributors:** Avoid destructive cleanup advice unless it includes clear backup and review warnings.

## 13. Improve Release Validation Report Readability

- **Type:** Tooling / documentation
- **Difficulty:** Intermediate
- **Background:** Release validation output should be easy for maintainers and contributors to interpret.
- **Expected outcome:** `artifacts/release-validation.json` or related output is easier to read, or docs explain how to summarize it.
- **Files likely involved:** `scripts/validate-release.ps1`, `docs/RELEASE_VALIDATION.md`, tests.
- **Notes for contributors:** Open an issue first if changing script behavior.

## 14. Add Minimal Example Project For Demo

- **Type:** Example
- **Difficulty:** Intermediate
- **Background:** A tiny demo repo would let users test task delegation without risking a real project.
- **Expected outcome:** A minimal example project or documented external fixture for demo tasks.
- **Files likely involved:** `examples/`, `docs/DEMO_SCRIPT.md`, README docs.
- **Notes for contributors:** Keep the example small, dependency-light, and safe to modify inside a Worktree.
