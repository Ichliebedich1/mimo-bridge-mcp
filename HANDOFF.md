# mimo-bridge-mcp 交接文档

**更新日期：2026年6月20日**
**当前状态：P0-P3 可用；P4 队列行为待修复；P4.5 低成本审查和 P5 本地管理界面已实现**

---

## 交接摘要

- 当前范围：P5 管理界面、共享 HTTP MCP 和 Codex 审查交接。
- 目标：管理界面、Codex 和 MiMo 使用同一个守护进程，同时保留 Codex 直接执行复杂任务的能力。
- 已完成：本地管理界面、共享守护进程、10 个 MCP 工具、Review-first 工作台、“交给 Codex 审查”入口和安全任务删除。
- 协作方式：界面按钮复制带任务 ID 的低上下文审查指令并打开 Codex 新会话；Codex 重启后通过共享 HTTP MCP 查询和调度任务。
- 当前阻塞：P4 第二个写任务虽然返回 `queued`，实际仍可能立即启动。
- 建议下一步：重启 Codex 使 HTTP 配置生效，做一次“界面下发 -> Codex 审查 -> MiMo 修复/合并”的真实冒烟，再修复 P4。

---

## 一、当前 Git 状态

- 分支：`master`
- 当前工作区：P5 管理界面、守护进程、测试、Codex 交接按钮和文档尚未提交
- 最新提交：`694c14e P4.5 Token Budget Review / 低成本审查协议`

| 提交 | 内容 |
|------|------|
| `d771af8` | P0 固化版本 |
| `7d76caa` | P1 任务生命周期 |
| `915c2bd` | P2 可靠性与协议测试 |
| `833db96` | P2 交接文档 |
| `6ae45c9` | P3 Git Worktree 隔离与差异审计 |
| `5e62d57` | P3 交接文档更新 |
| `bfe26f0` | P3 修复：Codex 审核问题 |
| `5505afc` | P3 修复交接文档更新 |
| `4a505e4` | P4 队列和只读并发 |
| `ab79b9d` | P4 交接文档 |
| `cdd486f` | P0-P4 项目文档 |

---

## 二、测试验证状态

- `npm.cmd run build`：通过
- UI/daemon/MCP/交接定向测试：11/11 通过
- 排除已知挂起的 `runner-integration.test.mjs` 后，全量回归：169/169 通过
- 回归仍会输出既有的 Windows `node-pty AttachConsole failed` 和 `TimeoutNaNWarning`，测试进程退出码为 0
- P4 队列单元测试虽通过，但独立行为复现仍显示第二个写任务会立即启动，因此 P4 不能标记验收通过

---

## 三、P4 完成内容

### 3.1 写任务队列

文件：`src/services/task-queue.ts`

| 功能 | 说明 |
|------|------|
| TaskQueue 类 | 管理写任务队列 |
| enqueue | 入队并按优先级排序 |
| cancel | 取消队列中的任务 |
| cancelAll | 取消所有队列任务 |
| getQueuedTasks | 获取队列任务信息 |
| onTaskComplete | 任务完成回调 |

### 3.2 工具修改

| 文件 | 修改内容 |
|------|----------|
| `src/tools/start-task.ts` | 支持任务队列，添加 priority 参数 |
| `src/tools/reply-task.ts` | 支持任务队列，添加 priority 参数 |
| `src/tools/cancel-task.ts` | 支持取消队列中的任务 |
| `src/index.ts` | 添加 mimo_queue_status 工具 |

### 3.3 测试覆盖

文件：`tests/task-queue.test.mjs`（11 个测试）

| 测试 | 说明 |
|------|------|
| enqueue and process | 入队和处理 |
| queue when max concurrent | 并发限制时排队 |
| prioritize higher priority | 优先级排序 |
| cancel queued task | 取消队列任务 |
| cancel non-existent | 取消不存在任务 |
| cancel all | 取消所有任务 |
| get queued tasks info | 获取队列信息 |
| report correct status | 状态报告 |
| queue start_task | start 排队 |
| allow get/list while running | 只读并发 |
| cancel queued task via handler | handler 取消 |

---

## 四、MCP 工具列表（10 个）

| 工具 | 说明 | P4 新增 |
|------|------|---------|
| `mimo_start_task` | 创建并启动任务 | 修改 |
| `mimo_get_task` | 查询任务状态 | |
| `mimo_reply_task` | 继续会话 | 修改 |
| `mimo_cancel_task` | 终止任务或取消队列 | 修改 |
| `mimo_finish_task` | 标记验收/放弃 | |
| `mimo_list_tasks` | 列出任务 | |
| `mimo_merge_task` | 合并/丢弃 Worktree | |
| `mimo_queue_status` | 查询队列状态 | ✅ |
| `mimo_token_status` | 查询或重置 Token 预算 | P4.5 |
| `mimo_delete_task` | 永久删除已结束且没有 Worktree 的任务 | P5.1 |

---

## 五、P4.5 Token Budget Review

- `mimo_get_task` 默认 `detail_level=review`，返回小体积 Review Package。
- MiMo 完成或失败时自动生成并持久化 Review Package；旧任务查询时可补生成。
- 支持 `summary -> review -> diff/logs/focused -> full` 逐级升级。
- diff、日志、文件和 full 都受 `max_chars`、行数及路径白名单限制。
- 越界修改、测试失败、非零退出和审查数据不可用会进入 `risk_flags`。
- 强制审查顺序见 `AGENTS.md` 和 `docs/modules/token-budget-review.md`。

---

## 六、下一步工作

1. 重启 Codex，使 `mimo_bridge = http://127.0.0.1:3210/mcp` 生效
2. 通过管理界面创建真实 MiMo 任务，并使用“交给 Codex 审查”完成一次端到端冒烟
3. 修复 P4 队列实际并发启动问题
4. 接入真实 MiMo Token 事件统计

---

## 七、P5.1 任务删除（已完成）

已完成但尚未提交 Git：

- 新增 `mimo_delete_task` 和 `DELETE /api/tasks/:id`。
- 只允许删除 `accepted/failed/cancelled/abandoned` 且没有 Worktree 的任务。
- 删除时清理任务 JSON、brief、stdout/stderr 日志。
- 任务列表和详情页已增加带二次确认的删除按钮。
- 根项目、daemon、管理界面构建通过；定向测试 13/13 通过；正常回归 169/169 通过。
- daemon 已用新构建恢复运行，health 为 `ok`。
- 浏览器 smoke 已确认 3 个 cancelled 任务显示删除按钮，确认框会明确列出任务 ID 和清理范围，取消后不会删除。
- 已通过固定 `DELETE /api/tasks/:id` 删除 `task_e6d86ca0d3d7`、`task_90714e416eee`、`task_8500dacfab07`。
- 删除后 `/api/tasks` 和 `mimo_list_tasks` 均为空，`runtime/tasks`、`runtime/briefs`、`runtime/logs` 无对应残留。
- 共享 HTTP MCP 实测返回 10 个工具并包含 `mimo_delete_task`。

仍需注意：所有 P5/P5.1 代码和文档目前仍未提交 Git；P4 队列行为问题与本功能无关，仍需单独修复。

---

**MiMo Code（Xiaomi MiMo）**  
**更新日期：2026年6月20日**
