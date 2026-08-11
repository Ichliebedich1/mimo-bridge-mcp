# MiMo Bridge MCP 操作手册

## 命令前缀

安装版优先使用：

```powershell
$Client = "$env:LOCALAPPDATA\MiMoBridgeApp\MiMo Bridge Client.cmd"
& $Client health
```

便携包使用包内 `MiMo Bridge Client.cmd`；只有源码开发模式才改用 `node .\scripts\mimo-bridge-client.mjs`。发行客户端是零安装依赖工具，不依赖源码仓库的 MCP SDK。

健康检查至少确认：

- `daemon.status` 为 `ok`。
- `daemon.identity` 为 `mimo-bridge-local-daemon/v1`。
- `mcp.status` 为 `ready`。
- `config.reload_required` 为 `false`。
- 队列容量为 8；路径重叠和未知修改范围仍可能保守串行。

## P0 启动契约

### 任务请求文件

含中文/空格路径、多行目标或附件时，把请求写入 UTF-8 JSON 文件。`editable_paths` 应尽量小，`max_rounds` 必须在 1 到 10 之间。

启动时显式提供稳定的 `idempotency_key`（命令行参数为 `--idempotency-key`）：

```powershell
& $Client start --json .\task.json --idempotency-key "replace-with-one-stable-uuid"
& $Client agent-start --agent-id reasonix-tui --json .\task.json --idempotency-key "replace-with-one-stable-uuid"
```

正常磁盘条件下应在 5 秒内收到 `task_id`、`request_id`、`preparing_worktree` 和 `queue_state`。客户端自动生成幂等键时也会把它输出；必须保存该键，超时重试不得生成新键。

### 幂等冲突

- 同键同参数：返回同一任务，`idempotent_replay=true`。
- 同键不同参数：返回 `IDEMPOTENCY_CONFLICT`，不得改键绕过冲突；先核对原请求。
- 超时、断线或守护进程重启：仍复用原键和完全相同的请求文件。

### 阶段与队列

启动阶段为：

```text
preparing_worktree -> starting_agent -> running
```

`preparing_worktree` 说明占位记录已经持久化，后台仍在准备 Worktree/附件/任务说明；不要把它误判为挂死。队列最多并行 8 个互不冲突的任务，第九个或路径冲突任务会排队。

## 常见故障与处理

### 直接 MCP 等待在宿主侧超时

现象：Codex 直接调用 `mimo_wait_task` 或 `agent_wait_task` 时宿主先超时，但 MiMo/Reasonix 仍在运行。

处理：保留 `task_id`，改用发行客户端做一次有界等待：

```powershell
& $Client wait --task-id task_xxx --timeout-seconds 1800
& $Client agent-wait --agent-id reasonix-tui --task-id task_xxx --timeout-seconds 1800
```

一次等待超时后按指数退避再次等待，只返回最小状态；不要高频调用 `mimo_get_task`，也不要新建替代任务。

### Codex 漏掉完成通知

上下文压缩、中断、断线或等待位置错误后，先恢复再审查：

```powershell
& $Client recover --limit 5 --max-chars 8000
& $Client agent-recover --agent-id reasonix-tui --limit 5 --max-chars 8000
```

失败任务也可能保留有价值的 Worktree 修改。先读有界 Review Package，再决定继续、丢弃或清理。

如果安装版 pending-review 路由返回 404，先确认健康身份和安装版本；队列空闲后用安装版启动器重启。只有源码开发模式才重新构建守护进程。

### 阶段失败与 request_id 定位

任务失败时记录以下结构化字段：

```text
error_detail = { code, message, phase, request_id, occurred_at, retryable }
```

定位顺序：

1. 保存 start 返回的 `request_id` 和 `task_id`。
2. 从有界 Review Package 确认任务状态和兼容错误摘要。
3. 使用 `review --detail-level logs --max-chars 8000`，仅按 `request_id` 读取并匹配相关日志尾部中的阶段和错误码。
4. 若 `retryable=true`，优先恢复/回复原任务；不要用新幂等键重复创建。

不得输出完整日志、完整命令行、原始配置、凭据或其他 allowedRoots。

### `WORKSPACE_NOT_ALLOWED`

错误详情只应包含本次请求的规范化路径、实际配置文件、配置来源/加载时间、脱敏配置指纹、`reload_required`、有效根目录数量和修复命令；不应列出其他根目录。

任务不能自动修改 `allowedRoots`。用户确认后在本机执行：

```powershell
& "$env:LOCALAPPDATA\MiMoBridgeApp\MiMo Bridge Launcher.cmd" allow-root -Path "C:\path\to\project" -Restart
```

如果只是磁盘配置已变化，先确保队列空闲，再使用 `health.config.restart_command`。不要在运行任务时重启。

### 守护进程在任务运行时重启

守护进程拥有 Runner 进程。重启会中断正在运行的任务，并把遗留非终态任务标为带 `DAEMON_RESTARTED` 的失败任务。

处理：运行 `recover`/`agent-recover`，审查 Review Package，再选择回复续跑或丢弃 Worktree。不要直接删除任务数据。

### Reasonix 达到 `max_steps`

Reasonix 因 `agent.max_steps` 暂停通常表示未完成，不一定表示修改不可用：

```powershell
& $Client agent-review --agent-id reasonix-tui --task-id task_xxx --detail-level review --max-chars 8000
& $Client agent-reply --agent-id reasonix-tui --task-id task_xxx --json .\reply.json
& $Client agent-wait --agent-id reasonix-tui --task-id task_xxx --timeout-seconds 1800
```

回复时让 Reasonix 从保存的会话继续。大型任务应使用更高的 Reasonix `max_steps` 配置；MiMo 的 `max_rounds` 仍不得超过 10。

### 内联 JSON 或 PowerShell 引用失败

中文、空格、引号、尖括号、反斜杠或换行可能在到达 Bridge 前被 shell 破坏。用 UTF-8 JSON 文件和 `--json`；把这类错误归为 Bridge 调用失败，而不是 MiMo/Reasonix 执行失败。

### 图片/多模态任务

图片任务使用 MiMo Agent。任意已启用的 MiMo Code 模型都可通过 MiMo Code 多模态桥接处理图片，不要强制改写为 V2.5。Reasonix 在当前集成中仍是文本边界。

## 低上下文审查顺序

1. 首次读取 `detail_level="review"`，通常 `max_chars=8000`。
2. 核对 `editable_paths`、`changed_files` 和越界报告。
3. 检查 diff stat、变更行摘要、测试结果和退出码。
4. 检查 `risk_flags` 和审查建议。
5. 低风险时直接决定；证据不足时只请求相关 diff/文件/日志尾部。
6. `detail_level="full"` 仅用于明确调试，并记录为何升级。

```powershell
& $Client review --task-id task_xxx --detail-level diff --max-chars 12000
& $Client review --task-id task_xxx --detail-level focused --max-chars 12000
& $Client review --task-id task_xxx --detail-level logs --max-chars 8000
```

Reasonix 使用相同 detail-level，但命令为 `agent-review --agent-id reasonix-tui`。

## 命令矩阵

| 需求 | MiMo | Reasonix / 通用 Agent |
| --- | --- | --- |
| 健康/Agent 列表 | `health` | `agent-list` |
| 启动 | `start --json task.json --idempotency-key key` | `agent-start --agent-id reasonix-tui --json task.json --idempotency-key key` |
| 等待 | `wait --task-id task_xxx --timeout-seconds 1800` | `agent-wait --agent-id reasonix-tui --task-id task_xxx --timeout-seconds 1800` |
| 审查 | `review --task-id task_xxx --detail-level review --max-chars 8000` | `agent-review --agent-id reasonix-tui --task-id task_xxx --detail-level review --max-chars 8000` |
| 恢复 | `recover --limit 5 --max-chars 8000` | `agent-recover --agent-id reasonix-tui --limit 5 --max-chars 8000` |
| 回复 | `reply --task-id task_xxx --json reply.json` | `agent-reply --agent-id reasonix-tui --task-id task_xxx --json reply.json` |
| 队列 | 管理界面/任务列表 | `agent-queue --agent-id reasonix-tui` |
| 完成 | MCP `mimo_finish_task` / 管理界面 | `agent-finish --agent-id reasonix-tui --task-id task_xxx --status accepted` |
| 合并 | MCP `mimo_merge_task` / 管理界面 | `agent-merge --agent-id reasonix-tui --task-id task_xxx --action merge` |

## 烟雾测试与永久操作

需要验证 Review Package diff 时，使用 Git 已跟踪的测试 fixture。不要用被忽略的 `runtime/...` 作为 diff 验证目标，否则真实写入也可能显示 `changed_files: []`。

`delete` 是永久操作。只删除状态为 `accepted`、`failed`、`cancelled` 或 `abandoned` 且已经确认没有 Worktree 的任务；浏览器操作必须经过确认对话框。

## 禁止事项

- 不要重复轮询 `mimo_get_task` 等待状态变化。
- 不要用新幂等键重试同一个逻辑任务。
- 不要让任务自动扩大 `allowedRoots`。
- 不要为常规审查读取完整仓库、完整 diff 或完整 stdout/stderr。
- 不要把客户端等待超时当成 Agent 失败。
- 不要在审查/合并决策完成前删除 Worktree 或运行时数据。
