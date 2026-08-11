---
name: use-mimo-bridge-mcp
description: Use when Codex 需要通过 MiMo Bridge MCP 委派、等待、恢复或审查 MiMo Code/Reasonix 任务。覆盖发行客户端、幂等重试、P0 启动阶段、request_id 定位、低上下文 Review Package、allowedRoots 与安全生命周期操作。
---

# 使用 MiMo Bridge MCP

## 核心规则

把 MiMo Bridge 当作有边界的委派系统：Codex 负责规划和审查，MiMo 或 Reasonix 只在配置的安全边界内执行，最终合并、丢弃或继续任务的决定由 Codex 或用户作出。

默认从有界的 Review Package 开始，只有风险证据不足时，才读取相关 diff、文件或日志尾部。不要为了方便读取整个仓库、完整日志或完整 diff。

## 先选择正确的客户端

优先使用不依赖源码 `node_modules` 的发行客户端：

```powershell
& "$env:LOCALAPPDATA\MiMoBridgeApp\MiMo Bridge Client.cmd" health
```

便携包中使用当前目录的 `MiMo Bridge Client.cmd`。只有明确在源码仓库开发时，才使用：

```powershell
node .\scripts\mimo-bridge-client.mjs health
```

下文的 `$Client` 表示已经确认存在的发行客户端路径：

```powershell
$Client = "$env:LOCALAPPDATA\MiMoBridgeApp\MiMo Bridge Client.cmd"
```

不要因为源码目录缺少 `node_modules` 或 `@modelcontextprotocol/sdk` 就判定客户端不可用；发行客户端只使用内置 Node 模块和 REST。

## 首次检查

1. 运行 `& $Client health`。
2. 确认 `daemon.status="ok"`、`daemon.identity="mimo-bridge-local-daemon/v1"` 和 `mcp.status="ready"`。
3. 检查 `config.reload_required`；为 `true` 时不要直接开始新任务。
4. 如果 Codex 中缺少 MCP 工具，确认 MCP 地址为 `http://127.0.0.1:3210/mcp`。配置传输变化通常需要重启 Codex或新开会话。

## 委派流程

1. 对含中文路径、空格、引号或多行目标的请求，创建 UTF-8 JSON 文件；不要用内联 PowerShell/Node 拼接 JSON。
2. 为每次逻辑任务生成唯一且稳定的 `idempotency_key`，超时或断线重试时复用同一个键和完全相同的参数；不同逻辑任务不得共用该键。
3. MiMo 使用 `start`；Reasonix 使用 `agent-start --agent-id reasonix-tui`。
4. 新任务应在 5 秒内返回 `task_id`、`request_id`、`status="preparing_worktree"`、`queue_state` 和 `idempotent_replay`。这只是成功持久化占位任务，不代表 Agent 已运行。
5. 启动阶段正常顺序是 `preparing_worktree -> starting_agent -> running`；路径冲突或容量限制可能让任务保持排队状态。
6. 启动后只做一次有界等待，不要高频轮询 `get_task`。
7. 从 `detail_level="review"` 的 Review Package 开始审查，再按风险最小化升级读取范围。
8. 只有 Codex 或用户验收后才执行 finish/merge/discard/delete。

同一幂等键和同一请求会返回原任务，并设置 `idempotent_replay=true`；同一键配不同参数会返回 `IDEMPOTENCY_CONFLICT`。遇到超时不得换新键创建“替代任务”。

`max_rounds` 的有效范围是 `1-10`，MCP Schema 上限固定为 `10`。

## 命令选择

MiMo 任务：

```powershell
& $Client start --json .\task.json --idempotency-key "replace-with-one-stable-uuid"
& $Client wait --task-id task_xxx --timeout-seconds 1800
& $Client review --task-id task_xxx --detail-level review --max-chars 8000
& $Client recover --limit 5 --max-chars 8000
```

Reasonix 或通用 Agent 任务：

```powershell
& $Client agent-list
& $Client agent-start --agent-id reasonix-tui --json .\task.json --idempotency-key "replace-with-one-stable-uuid"
& $Client agent-wait --agent-id reasonix-tui --task-id task_xxx --timeout-seconds 1800
& $Client agent-review --agent-id reasonix-tui --task-id task_xxx --detail-level review --max-chars 8000
& $Client agent-recover --agent-id reasonix-tui --limit 5 --max-chars 8000
& $Client agent-queue --agent-id reasonix-tui
```

图片/多模态任务仍只交给 MiMo Agent，但可使用任意已启用的 MiMo Code 模型，由 MiMo Code 的多模态桥接路由处理；Reasonix 仍按文本任务边界使用。不要再把图片任务强制改写为 MiMo V2.5。

## 超时、恢复与错误定位

长等待优先使用发行客户端。直接调用 `mimo_wait_task` 或 `agent_wait_task` 可能先触发宿主侧超时，但守护进程和任务仍会继续。

等待超时后保留 `task_id`，按指数退避再次做有界等待；不要启动新任务。发生上下文压缩、网络中断或可疑静默后，先运行 `recover`/`agent-recover`，再决定是否继续。

任何失败都先记录并关联：

- `request_id`
- `error_detail.code`
- `error_detail.phase`
- `error_detail.retryable`
- `error_detail.occurred_at`

错误阶段可能是 `validation`、`preparing_worktree`、`starting_agent`、`running` 或 `daemon`。服务端会把这些字段持久化到任务记录。先用 start 返回的 `request_id` 关联队列结果；终态失败时用 `review --detail-level logs --max-chars 8000` 读取有界日志尾部并按该 ID 定位。不要为了定位错误输出完整命令行、原始配置、其他 allowedRoots、完整源码或凭据。

## allowedRoots 与配置重启

`allowedRoots` 是机器级硬边界，任务不得自动扩权。`WORKSPACE_NOT_ALLOWED` 时只使用错误返回的本次规范化路径、配置文件、脱敏指纹、加载时间、`reload_required`、有效根目录数量和修复命令；不得枚举其他根目录。

新增根目录必须由用户在本机明确确认：

```powershell
& "$env:LOCALAPPDATA\MiMoBridgeApp\MiMo Bridge Launcher.cmd" allow-root -Path "C:\path\to\project" -Restart
```

若 `health.config.reload_required=true`，先确认队列没有运行任务，再使用健康接口给出的 restart 命令。源码开发模式才使用源码目录的 `apps\local-daemon\launcher.ps1 restart`。

## 生命周期安全

- 保持 `allowedRoots`、`editable_paths` 和 Worktree 隔离。
- 不接受未经明确审查的越界修改。
- MiMo/Reasonix 不得自行合并 Worktree。
- 重启守护进程前先检查队列；重启会把遗留非终态任务记录为带 `DAEMON_RESTARTED` 的失败任务。
- `delete` 是永久操作：仅对 `accepted`、`failed`、`cancelled` 或 `abandoned` 且确认没有 Worktree 的任务执行。
- 启动器/客户端引用失败属于 Bridge 调用失败，不等同于 Agent 执行失败。

## 更多细节

任务涉及超时、漏掉完成通知、失败阶段定位、Reasonix 续跑、队列状态、配置重启或烟雾测试时，读取 `references/playbook.md`。
