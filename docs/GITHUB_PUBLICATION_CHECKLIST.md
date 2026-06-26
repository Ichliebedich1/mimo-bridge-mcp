# GitHub Publication Checklist

Use this checklist when preparing the public GitHub repository page for **AgentBridge Local**.

## Repository About

Suggested description:

```text
Local-first MCP orchestration console for Codex, MiMo Code, Reasonix TUI, and bounded Git Worktree review workflows.
```

Shorter alternative:

```text
Let Codex coordinate local coding agents through safe MCP tasks, Git Worktrees, and low-token Review Packages.
```

Suggested website:

```text
http://127.0.0.1:3210/
```

Only use the localhost Admin UI as a local reference. Do not present it as a public hosted website.

## Topics

Recommended topics:

```text
mcp
model-context-protocol
codex
coding-agent
ai-agent
agentic-coding
local-first
windows
git-worktree
token-optimization
developer-tools
llm-tools
mimo-code
reasonix
multi-agent
```

If GitHub topic limits require a shorter list, prioritize:

```text
mcp
model-context-protocol
codex
coding-agent
ai-agent
local-first
git-worktree
token-optimization
multi-agent
windows
```

## Repository Features

Recommended settings:

- Enable Issues.
- Enable Discussions if you want a place for setup help and workflow feedback.
- Enable Wiki only if you plan to maintain it; otherwise keep docs in the repository.
- Enable GitHub private vulnerability reporting if available.
- Keep Actions enabled if CI or release validation workflows are added later.

## First-Screen README Check

The top of the README should make these points clear in under 30 seconds:

- AgentBridge Local is the new project name.
- Former name: MiMo Bridge MCP.
- Codex plans and reviews.
- MiMo / Reasonix execute bounded tasks.
- Tasks run in Git Worktrees.
- Codex starts from a compact Review Package instead of full logs/diffs/source.
- The daemon is localhost-only.
- Windows 10/11 x64 is the first target.

## Pinned / Highlighted Content

Recommended links to mention in the repository README or release:

- `README.md` for the English landing page.
- `README_zh-CN.md` for Chinese users.
- `docs/TROUBLESHOOTING.md` for setup failures.
- `docs/GOOD_FIRST_ISSUES.md` for contributor entry points.
- `docs/RELEASE_NOTES_v0.1.0-alpha.md` for the first alpha release.
- `docs/RELEASE_VALIDATION.md` for clean Windows testing.
- `docs/DEMO_SCRIPT.md` for launch copy and demo video/GIF planning.

## First Release Checklist

Before publishing `v0.1.0-alpha`:

- Confirm clean Windows 10 x64 portable ZIP validation.
- Confirm clean Windows 11 x64 EXE installer validation.
- Confirm MiMo Code and Reasonix are described as separately installed tools.
- Confirm Codex MCP endpoint documentation uses `http://127.0.0.1:3210/mcp`.
- Confirm Admin UI documentation uses `http://127.0.0.1:3210/`.
- Confirm artifact naming is explained: release files still use `MiMoBridge...` for compatibility while the product name is AgentBridge Local.
- Confirm no artifacts contain credentials, logs, local data, active tasks, or Worktrees.
- Attach release artifacts only after a clean packaging run.

## Suggested Release Assets

- `MiMoBridge-portable-win10-win11-x64.zip`
- `MiMoBridgeSetup-win10-win11-x64.exe`
- `release-validation.json` if it does not contain private local paths or sensitive details.

## Suggested Social Launch Targets

- GitHub release.
- X / Twitter.
- Reddit communities focused on local AI agents, MCP, and developer tools, following each community's self-promotion rules.
- Hacker News "Show HN" only after a clean demo and README are ready.
- V2EX or similar Chinese developer communities.
- Zhihu / Juejin / Shaoshupai if you want a Chinese write-up around the workflow problem.
- Discord / Slack communities where MCP, Codex, or agentic coding tools are discussed.

## Suggested Launch Copy

```text
AgentBridge Local lets Codex coordinate local coding agents without giving them the keys to your repo.

Codex plans and reviews. MiMo Code or Reasonix TUI executes in an isolated Git Worktree. Codex starts from a compact Review Package, then escalates only to focused diffs, files, or logs when risk requires it.

Windows-first alpha. Feedback and clean-machine testing welcome.
```

## Manual Checks After Publishing

- Open the repository in a logged-out browser and confirm the first screen explains the value in under 30 seconds.
- Click README links to make sure Chinese README, troubleshooting, release notes, and good first issues resolve correctly.
- Create a test issue from each issue template and cancel before submitting.
- Preview the PR template in a test branch or draft PR.
- Confirm GitHub's license detection recognizes MIT.
- Confirm topics display correctly on the repository page.
