# GitHub Publication Checklist

Use this checklist when preparing the public GitHub repository page for MiMo Bridge MCP.

## Repository About

Suggested description:

```text
MCP bridge that lets Codex delegate bounded coding tasks to MiMo Code in isolated Git Worktrees.
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
mimo
mimo-code
coding-agent
ai-agent
agentic-coding
claude-code
local-first
windows
git-worktree
token-optimization
developer-tools
llm-tools
```

If GitHub topic limits require a shorter list, prioritize:

```text
mcp
model-context-protocol
codex
mimo-code
coding-agent
ai-agent
git-worktree
token-optimization
```

## Repository Features

Recommended settings:

- Enable Issues.
- Enable Discussions if you want a place for setup help and workflow feedback.
- Enable Wiki only if you plan to maintain it; otherwise keep docs in the repository.
- Enable GitHub private vulnerability reporting if available.
- Keep Actions enabled if CI or release validation workflows are added later.

## Pinned / Highlighted Content

Recommended links to mention in the repository README or release:

- `README.md` for the English landing page.
- `README_zh-CN.md` for Chinese users.
- `docs/TROUBLESHOOTING.md` for setup failures.
- `docs/GOOD_FIRST_ISSUES.md` for contributor entry points.
- `docs/RELEASE_NOTES_v0.1.0-alpha.md` for the first alpha release.
- `docs/RELEASE_VALIDATION.md` for clean Windows testing.

## First Release Checklist

Before publishing `v0.1.0-alpha`:

- Confirm clean Windows 10 x64 portable ZIP validation.
- Confirm clean Windows 11 x64 EXE installer validation.
- Confirm MiMo Code installed/logged-in requirement is clear.
- Confirm Codex MCP endpoint documentation uses `http://127.0.0.1:3210/mcp`.
- Confirm Admin UI documentation uses `http://127.0.0.1:3210/`.
- Confirm no artifacts contain MiMo credentials, logs, local data, active tasks, or Worktrees.
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
- 知乎 / 掘金 / 少数派 if you want a Chinese write-up around the workflow problem.
- Discord / Slack communities where MCP, Codex, or agentic coding tools are discussed.

## Manual Checks After Publishing

- Open the repository in a logged-out browser and confirm the first screen explains the value in under 30 seconds.
- Click README links to make sure Chinese README, troubleshooting, release notes, and good first issues resolve correctly.
- Create a test issue from each issue template and cancel before submitting.
- Preview the PR template in a test branch or draft PR.
- Confirm GitHub's license detection recognizes MIT.
- Confirm topics display correctly on the repository page.
