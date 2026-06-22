# Demo Script And Launch Copy

This document provides short demo scripts and launch copy for MiMo Bridge MCP.

## 30-Second GIF Script

Goal: show the value without requiring viewers to understand the whole implementation.

1. Show README title and one-line positioning:
   - "Codex plans and reviews; MiMo Code executes isolated coding tasks inside Git Worktrees."
2. Start the local daemon:

   ```powershell
   powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 start -Open
   ```

3. Show Admin UI open at:

   ```text
   http://127.0.0.1:3210/
   ```

4. Show Codex connected to:

   ```text
   http://127.0.0.1:3210/mcp
   ```

5. Show a small bounded task being started.
6. Show a review summary with changed files, risk flags, and focused diff.
7. End on "Accept or discard Worktree after review."

Suggested caption:

```text
Codex plans/reviews. MiMo Code executes in an isolated Git Worktree. Codex reads a small review package before deciding what to merge.
```

## 3-Minute Video Script

### 0:00-0:20 - Problem

Codex is strong at planning, architecture, and review. But using it for long code-writing loops can consume a lot of output tokens. The goal is to keep Codex in control while delegating bounded implementation work.

### 0:20-0:45 - Architecture

Show the flow:

```text
Codex -> MCP -> Local MiMo Bridge Daemon -> MiMo Code Runner -> Git Worktree -> Review Package -> Accept or Discard
```

Emphasize:

- Localhost-only daemon.
- Windows-first.
- Git Worktree isolation.
- MiMo Code does not merge its own Worktree.

### 0:45-1:20 - Setup

Show prerequisites:

- Windows 10/11 x64.
- MiMo Code installed and logged in.
- Git installed.
- Codex with MCP support.

Start daemon:

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/start-local.ps1
```

Show:

```text
Admin UI: http://127.0.0.1:3210/
MCP:      http://127.0.0.1:3210/mcp
```

### 1:20-2:20 - Task Flow

Show a small task:

1. Codex creates a bounded task.
2. MiMo Code executes inside a task Worktree.
3. Codex waits once with a bounded timeout.
4. Codex reads `detail_level="review"`.
5. Codex escalates only to focused diff or logs if needed.

Narration:

```text
The important part is that Codex does not need to read the whole repository or full logs first. It starts with a compact review package.
```

### 2:20-2:50 - Review And Decision

Show review summary, changed files, and risk flags. Then show accept/discard decision.

Narration:

```text
MiMo Code executes. Codex reviews. The final merge decision stays with Codex or the user.
```

### 2:50-3:00 - Call For Contributors

Ask for:

- Clean Windows 10/11 testing.
- Installer and portable ZIP validation.
- Codex MCP config examples.
- Troubleshooting improvements.
- Admin UI screenshots and demo GIFs.

## 中文发布标题

```text
我做了一个让 Codex 调度 MiMo Code 干活的 MCP：主模型负责审核，低成本模型负责写代码
```

## 中文发布文案

我在使用 Codex 做开发时遇到一个问题：Codex 很适合规划和审核，但让它大量写代码会消耗很多 token。于是我做了一个 MiMo Bridge MCP，让 Codex 把有边界的编码任务交给 MiMo Code 执行。

Codex 负责规划、约束和审核；MiMo Code 在独立 Git Worktree 中执行具体修改。Codex 最后只需要看 review 摘要、关键 diff 和风险点，再决定接受或丢弃。

这个项目的重点不是“又一个 MCP”，而是一个更可控的协作流程：主模型做判断，执行模型做具体修改，每个任务用 Git Worktree 隔离，最后由 Codex / 用户审核。

项目目前 Windows-first，欢迎测试、提 Issue、提 PR，尤其欢迎 clean Windows 10/11、portable ZIP、EXE installer、Codex MCP 配置和 Admin UI 体验反馈。

## English Launch Title

```text
I built an MCP bridge that lets Codex delegate coding tasks to MiMo Code
```

## English Launch Copy

I built MiMo Bridge MCP: a local MCP bridge that lets Codex delegate bounded coding tasks to MiMo Code.

The idea is simple:

- Codex plans and reviews.
- MiMo Code executes inside isolated Git Worktrees.
- Codex only escalates to focused diffs/files/logs when needed.

The goal is to reduce token usage while keeping the stronger model in control of planning and review.

This is Windows-first and early alpha. I am looking for help testing the portable ZIP, EXE installer, Codex MCP integration, MiMo Code runner stability, and the review workflow.

## Short Social Variants

### English

```text
MiMo Bridge MCP lets Codex delegate bounded coding tasks to MiMo Code.

Codex plans/reviews.
MiMo Code executes in isolated Git Worktrees.
Codex reads compact review packages before deciding whether to merge.

Windows-first alpha. Feedback welcome.
```

### 中文

```text
MiMo Bridge MCP：让 Codex 把有边界的编码任务交给 MiMo Code 执行。

Codex 负责规划和审核，MiMo Code 在独立 Git Worktree 中改代码，最后由 Codex / 用户决定是否合并。

Windows-first alpha，欢迎测试和反馈。
```
