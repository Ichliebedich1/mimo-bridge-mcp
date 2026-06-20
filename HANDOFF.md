# mimo-bridge-mcp 交接文档

**更新日期：2026年6月20日**
**当前状态：P0-P5 核心功能可用；真实 Token 统计和审查空修改风险仍待完善**

---

## 交接摘要

- 当前范围：P4 写任务队列修复、共享 HTTP MCP 和 Codex 审查交接。
- 目标：管理界面、Codex 和 MiMo 使用同一个守护进程，同时保留 Codex 直接执行复杂任务的能力。
- 已完成：本地管理界面、共享守护进程、10 个 MCP 工具、Review-first 工作台、“交给 Codex 审查”入口和安全任务删除。
- 协作方式：界面按钮复制带任务 ID 的低上下文审查指令并打开 Codex 新会话；Codex 重启后通过共享 HTTP MCP 查询和调度任务。
- 代码阻塞：无；P4 已绑定真实 Runner 完成、失败或取消回调，写任务会实际串行。
- 运行阻塞：`127.0.0.1:3210` 当前离线。新 daemon 曾通过 health/MCP/UI smoke，但未持续驻留。
- 建议下一步：用 `apps/local-daemon/start-local.ps1` 恢复 daemon，确认跨会话持续驻留后再做真实端到端冒烟。

---

## 一、当前 Git 状态

- 分支：`master`
- 当前工作区：干净
- 最新代码提交：`8a58d84 Fix P4 write task serialization`
- 最新文档提交：`dc497cf Update P4 handoff status`

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
| `c909016` | P5 共享管理界面和安全任务删除 |
| `8a58d84` | P4 实际串行执行、取消清理和界面解锁 |

---

## 二、测试验证状态

- `npm.cmd run build`：通过
- UI/daemon/MCP/交接定向测试：11/11 通过
- 排除已知挂起的 `runner-integration.test.mjs` 后，全量回归：175/175 通过
- 回归仍会输出既有的 Windows `node-pty AttachConsole failed` 和 `TimeoutNaNWarning`，测试进程退出码为 0
- P4 新增 6 个可控 Runner 行为测试，验证完成、失败、取消、reply 和 Worktree 清理，P4 行为验收通过

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

1. 使用 `powershell -ExecutionPolicy Bypass -File apps/local-daemon/start-local.ps1` 启动 daemon，并确认 3210 端口跨会话持续驻留
2. 重启 Codex，使 `mimo_bridge = http://127.0.0.1:3210/mcp` 重新建立连接
3. 通过管理界面创建真实 MiMo 任务，并使用“交给 Codex 审查”完成一次端到端冒烟
4. 修复“编码任务零修改且未报告测试时 Review Package 仍建议 approve”的审查风险
5. 接入真实 MiMo Token 事件统计

---

## 七、P5.1 任务删除（已完成）

已完成并提交到 `c909016`：

- 新增 `mimo_delete_task` 和 `DELETE /api/tasks/:id`。
- 只允许删除 `accepted/failed/cancelled/abandoned` 且没有 Worktree 的任务。
- 删除时清理任务 JSON、brief、stdout/stderr 日志。
- 任务列表和详情页已增加带二次确认的删除按钮。
- P5/P5.1 完成时正常回归 169/169 通过；当前包含 P4 修复后的正常回归为 175/175。
- daemon 已用新构建恢复运行，health 为 `ok`。
- 浏览器 smoke 已确认 3 个 cancelled 任务显示删除按钮，确认框会明确列出任务 ID 和清理范围，取消后不会删除。
- 已通过固定 `DELETE /api/tasks/:id` 删除 `task_e6d86ca0d3d7`、`task_90714e416eee`、`task_8500dacfab07`。
- 删除后 `/api/tasks` 和 `mimo_list_tasks` 均为空，`runtime/tasks`、`runtime/briefs`、`runtime/logs` 无对应残留。
- 共享 HTTP MCP 实测返回 10 个工具并包含 `mimo_delete_task`。

P5/P5.1 已形成可回退 Git 基线。

---

## 八、P4 队列修复（2026-06-20）

- 所有 start/reply 写任务统一进入 `TaskQueue`，首个任务不再绕过队列。
- 队列 Promise 绑定真实 Runner 完成、失败或取消，Runner 运行期间不会提前释放。
- 同一任务已有 queued reply 时拒绝重复入队，并且不会覆盖原 brief。
- 取消 queued Worktree 任务会删除 Worktree、任务分支并清空 `task.worktree`。
- UI 已允许后续写任务进入队列，不再显示“queued 可能提前启动”的旧警告。
- 新增 6 个行为回归；正常回归 175/175 通过。
- 本次通过 MCP 下发给 MiMo 两轮，但 MiMo 只读取文件且未修改代码；任务已安全 discard 并标记 abandoned，最终修复由 Codex 完成。

---

## 九、压缩上下文前运行状态与技术债

### 9.1 当前运行状态

- Git：`master`，工作区干净；HEAD 为 `dc497cf`，P4 代码提交为 `8a58d84`。
- 构建：根项目、`apps/local-daemon`、`apps/admin-ui` 均通过。
- 回归：排除已知挂起的 `tests/runner-integration.test.mjs` 后，175/175 通过。
- 最后一次在线 smoke：daemon health 正常、HTTP MCP 返回 10 个工具、队列为空、新 UI 不含旧 P4 警告。
- 当前探测：`http://127.0.0.1:3210/api/health` 无法连接；需要重新启动并验证驻留方式。

### 9.2 剩余技术债

| 优先级 | 项目 | 影响 |
|---|---|---|
| 高 | daemon 启动后未持续驻留 | Codex/UI 无法通过共享 HTTP MCP 调度 MiMo |
| 高 | 零修改、未报告测试的编码任务仍可能得到 `approve` | 自动建议可能误导审核，必须由 Codex 检查 `changed_files_count` 和 `test_result` |
| 中 | 真实 Token 事件未接入 | Token 页面不能代表真实消耗 |
| 中 | 运行中 Worktree 任务取消后的清理链路需单独复核 | queued Worktree 已修复；active Worktree 取消不在本轮验收范围 |
| 低 | `runner-integration.test.mjs` 在 Windows 挂起 | 正常回归继续排除并明确记录 |
| 低 | Windows `node-pty AttachConsole failed` / `TimeoutNaNWarning` | 测试噪声；当前退出码和回归结果不受影响 |

### 9.3 验证命令

```powershell
npm.cmd run build
cd apps/local-daemon; npm.cmd run build
cd ../admin-ui; npm.cmd run build
cd ../..
$tests = rg --files tests -g '*.test.mjs' | Where-Object { $_ -notmatch 'runner-integration\.test\.mjs$' }
node --test $tests
```

---

**MiMo Code（Xiaomi MiMo）**  
**更新日期：2026年6月20日**
