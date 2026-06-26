# Demo Script And Launch Copy

This document provides short demo scripts and launch copy for **AgentBridge Local**.

Former name: MiMo Bridge MCP.

## 30-Second GIF Script

Goal: show the value without requiring viewers to understand the whole implementation.

1. Show README title and one-line positioning:
   - "Codex plans and reviews. MiMo / Reasonix execute bounded tasks in isolated Git Worktrees."
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
6. Show Agent routing: MiMo or Reasonix.
7. Show a Review Package with changed files, risk flags, and focused diff.
8. End on "Codex reviews. You decide what gets merged."

Suggested caption:

```text
AgentBridge Local lets Codex coordinate local coding agents safely.

Codex plans and reviews. MiMo / Reasonix execute in isolated Git Worktrees. Codex starts from a compact Review Package before deciding what to merge.
```

## 3-Minute Video Script

### 0:00-0:20 - Problem

Codex is strong at planning, architecture, and review. But using it for long code-writing loops can consume a lot of output tokens. The goal is to keep Codex in control while delegating bounded implementation work to local agents.

### 0:20-0:45 - Architecture

Show the flow:

```text
Codex -> MCP -> AgentBridge Local Daemon -> Agent Registry -> MiMo / Reasonix -> Git Worktree -> Review Package -> Accept or Discard
```

Emphasize:

- Localhost-only daemon.
- Windows-first.
- Git Worktree isolation.
- Per-task editable scope.
- Execution agents do not merge their own Worktrees.

### 0:45-1:20 - Setup

Show prerequisites:

- Windows 10/11 x64.
- MiMo Code installed and logged in for MiMo tasks.
- Reasonix installed/configured for Reasonix TUI tasks.
- Git installed.
- Codex with MCP support.

Start daemon:

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 start -Open
```

Show:

```text
Admin UI: http://127.0.0.1:3210/
MCP:      http://127.0.0.1:3210/mcp
```

### 1:20-2:20 - Task Flow

Show a small task:

1. Codex creates a bounded task.
2. The task uses Auto routing or manually selects MiMo / Reasonix.
3. The selected agent executes inside a task Worktree.
4. Codex waits once or recovers later from the pending-review inbox.
5. Codex reads the Review Package first.
6. Codex escalates only to focused diff or logs if needed.

Narration:

```text
The important part is that Codex does not need to read the whole repository or full logs first. It starts with a compact Review Package.
```

### 2:20-2:50 - Review And Decision

Show review summary, changed files, and risk flags. Then show accept/discard/merge decision.

Narration:

```text
The local agent executes. Codex reviews. The final merge decision stays with Codex or the user.
```

### 2:50-3:00 - Call For Contributors

Ask for:

- Clean Windows 10/11 testing.
- Installer and portable ZIP validation.
- Codex MCP config examples.
- MiMo / Reasonix task-flow testing.
- Troubleshooting improvements.
- Admin UI screenshots and demo GIFs.

## Chinese Launch Title

```text
我做了一个让 Codex 调度本地编码 Agent 的 MCP 工具：Codex 负责审查，MiMo / Reasonix 负责执行
```

## Chinese Launch Copy

我在使用 Codex 做开发时遇到一个问题：Codex 很适合规划和审查，但让它长时间直接写大量代码会消耗很多 token，也会让上下文变得越来越重。

所以我做了 **AgentBridge Local**。它是一个本地 MCP 协作调度台，让 Codex 可以把边界清楚的编码任务交给 MiMo Code 或 Reasonix TUI 执行。

核心流程是：

- Codex 拆任务、定边界、做审查。
- MiMo / Reasonix 在独立 Git Worktree 里改代码。
- 系统生成一个小体积 Review Package。
- Codex 先看摘要、风险、测试、变更文件。
- 只有需要时，Codex 才读取指定 diff、文件或日志。
- 最后由 Codex / 用户决定是否合并。

这个项目目前 Windows-first，仍是 early alpha。欢迎测试安装包、便携包、Codex MCP 配置、MiMo / Reasonix 任务流程，也欢迎补充截图、demo、文档和 Issue。

## English Launch Title

```text
AgentBridge Local: let Codex coordinate local coding agents without handing over your repo
```

## English Launch Copy

I built AgentBridge Local: a local-first MCP orchestration console that lets Codex coordinate MiMo Code, Reasonix TUI, and future local coding agents.

The workflow is simple:

- Codex plans and reviews.
- MiMo / Reasonix execute inside isolated Git Worktrees.
- Codex starts from a compact Review Package.
- Codex only escalates to focused diffs, files, or logs when needed.
- The final merge decision stays with Codex or the user.

The goal is to reduce token usage while keeping the stronger model in control of planning, scope, review, and acceptance.

This is Windows-first and early alpha. I am looking for help testing the portable ZIP, EXE installer, Codex MCP integration, MiMo / Reasonix task flows, and the review workflow.

## Short Social Variants

### English

```text
AgentBridge Local lets Codex coordinate local coding agents through MCP.

Codex plans/reviews.
MiMo or Reasonix executes in an isolated Git Worktree.
Codex starts from a compact Review Package before deciding whether to merge.

Windows-first alpha. Feedback welcome.
```

### Chinese

```text
AgentBridge Local：让 Codex 通过 MCP 调度本地编码 Agent。

Codex 负责规划和审查，MiMo / Reasonix 在独立 Git Worktree 里执行，最后由 Codex / 用户决定是否合并。

Windows-first alpha，欢迎测试和反馈。
```
