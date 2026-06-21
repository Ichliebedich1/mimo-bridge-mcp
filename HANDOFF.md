# mimo-bridge-mcp 交接文档

**更新日期：2026年6月21日**
**当前状态：P0-P5 核心功能可用；MiMo 工具调用中途终止与审查空修改风险已修复，真实 Token 统计仍待完善**

---

## 交接摘要

- 当前范围：P4 写任务队列修复、共享 HTTP MCP 和 Codex 审查交接。
- 目标：管理界面、Codex 和 MiMo 使用同一个守护进程，同时保留 Codex 直接执行复杂任务的能力。
- 已完成：本地管理界面、共享守护进程、11 个 MCP 工具、Review-first 工作台、“交给 Codex 审查”入口、安全任务删除和低 Token 等待。
- 协作方式：界面按钮复制带任务 ID 的低上下文审查指令并打开 Codex 新会话；Codex 重启后通过共享 HTTP MCP 查询和调度任务。
- 代码阻塞：无；P4 已绑定真实 Runner 完成、失败或取消回调，写任务会实际串行。
- 最新修复：Runner 不再把 `step_finish(reason="tool-calls")` 当作任务完成；零修改且未报告测试的编码任务不再建议 `approve`。
- 当前运行：`127.0.0.1:3210` health 为 `ok`、MCP 为 `ready`、MiMo 已配置、队列为空。
- 建议下一步：使用 `mimo_wait_task` 协作开发 P5.2 Windows 一键启动器。

---

## 一、当前 Git 状态

- 分支：`master`
- P4.6 功能提交：`522e7a7 Add low-token task waiting`
- 当前工作区：仅包含本次验收后的交接文档同步

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
| `748a994` | P4 修复后的压缩上下文交接状态 |

---

## 二、测试验证状态

- `npm.cmd run build`：通过
- UI/daemon/MCP/交接定向测试：11/11 通过
- 排除已知挂起的 `runner-integration.test.mjs` 后，全量回归：176/176 通过
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

## 四、MCP 工具列表（当前部署 11 个）

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
| `mimo_wait_task` | daemon 内单次等待任务完成或超时，返回受限摘要 | P4.6，已部署 |

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
4. 接入真实 MiMo Token 事件统计

---

## 七、P5.1 任务删除（已完成）

已完成并提交到 `c909016`：

- 新增 `mimo_delete_task` 和 `DELETE /api/tasks/:id`。
- 只允许删除 `accepted/failed/cancelled/abandoned` 且没有 Worktree 的任务。
- 删除时清理任务 JSON、brief、stdout/stderr 日志。
- 任务列表和详情页已增加带二次确认的删除按钮。
- P5/P5.1 完成时正常回归 169/169 通过；当前包含后续修复的正常回归为 176/176。
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
- 当时通过 MCP 下发给 MiMo 两轮只读不改，后续确认根因不是提示词，而是 Bridge 把中间 `step_finish(reason="tool-calls")` 误判成任务完成并杀掉进程。

---

## 九、压缩上下文前运行状态与技术债

### 9.1 当前运行状态

- Git：`master`；HEAD 为 `748a994`，当前工作区包含 2026-06-21 Runner/review 修复，尚未提交。
- 构建：根项目、`apps/local-daemon`、`apps/admin-ui` 均通过。
- 回归：排除已知挂起的 `tests/runner-integration.test.mjs` 后，176/176 通过。
- 最后一次在线 smoke：daemon health 正常、HTTP MCP 返回 10 个工具、队列为空、新 UI 不含旧 P4 警告。
- 当前探测：`http://127.0.0.1:3210/api/health` 正常，daemon 为 `ok`、MCP 为 `ready`、MiMo 已配置、队列为空；重启电脑后的自动恢复尚未实现。

### 9.2 剩余技术债

| 优先级 | 项目 | 影响 |
|---|---|---|
| 高 | daemon 跨 Codex 会话持续驻留尚未验证 | 进程退出后 Codex/UI 无法通过共享 HTTP MCP 调度 MiMo |
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

## 十、MiMo Runner 中途终止修复（2026-06-21）

- 真实失败日志每轮都以 `step_finish(reason="tool-calls")` 结束，Bridge 随即调用 `complete(0)` 并杀掉 PTY，所以 MiMo 只能读取第一批文件。
- `src/services/event-parser.ts` 新增统一终态判定；`tool-calls`、`tool_calls`、`tool-use`、`tool_use` 均视为继续执行。
- `src/services/mimo-runner.ts` 改为只在真正终态事件或进程退出时完成任务。
- Review Package 新增 `NO_CHANGES_AND_NO_TESTS` 风险；有可编辑路径的编码任务若零修改且未报告测试，推荐结果为 `needs_attention`。
- 新增两项行为回归，完整正常回归为 176/176。
- 真实 MiMo 隔离冒烟日志顺序为 `tool-calls -> read -> tool-calls -> edit -> tool-calls -> read -> stop`，目标文件成功改为预期内容；冒烟任务与文件已清理。

---

## 十一、上下文压缩交接与下一阶段（2026-06-21）

### 11.1 压缩后读取顺序

1. `docs/HANDOVER_STATUS.md`
2. 本文第十、十一节
3. `docs/modules/windows-launcher-portability.md`
4. `docs/OPEN_TASKS.md`
5. `AGENTS.md`

默认不要重新读取全仓。

### 11.2 当前不可丢失状态

- 分支 `master`，HEAD 为 `748a994`。
- Runner 终态修复、Review Package 空修改风险、对应测试和本轮文档仍未提交。
- 完整正常回归为 176/176；根项目、daemon、管理界面构建通过。
- daemon 当前正在 `127.0.0.1:3210` 运行，MCP ready，队列为空。
- 当前后台仍需手工命令启动；重启电脑后不会自动恢复。

### 11.3 已规划但未开发

- P5.2：移除启动脚本硬编码，增加本地配置、生产启动、一键启动界面、桌面快捷方式和可选登录自启。
- P5.3：Windows 10/11 x64 便携 ZIP 和安装包，包含 Node 与已构建产物；目标设备单独安装/登录 MiMo。
- 不重写现有 React 管理界面和 Node daemon，不复制 MiMo 凭据、活动任务或 Worktree。
- 第一实施动作必须是提交当前 Runner/review 修复基线，然后再开发启动器。

详细方案：`docs/modules/windows-launcher-portability.md`。

---

## 十二、P5.2 配置与只读运行查看（2026-06-21）

- P5.2 第一阶段已通过真实 MCP 协作完成并合并：持久化配置、环境覆盖、`start-production.ps1`。
- 默认配置文件：`%LOCALAPPDATA%\MiMoBridge\config.json`；当前本机配置保留原项目 runtime。
- MiMo 回复轮次已修复为继续使用保存的 Worktree，并在每轮完成后重新审计越界修改。
- 管理后台已增加“实时运行查看”：仅返回受限事件摘要，不读取完整日志、不暴露 stdin、不提供输入/停止控制。
- 已完成任务会向前选择最近存在的日志轮次；真实 API smoke 返回 round 2 的 5 条事件，881 字符，无 raw output/stdin。
- 根、daemon、UI 构建通过；正常回归 223/223（继续排除已知挂起的 `runner-integration.test.mjs`）。
- 自动浏览器点击未执行：Python Playwright 不存在，安装超时；静态资源、API、UI build 和测试均通过。

## 十三、压缩交接与 P4.6（2026-06-21）

### 13.1 当前 Git 与运行状态

- `master`，HEAD：`cc59c1a Show latest completed MiMo task events`。
- daemon 由无触发器的临时计划任务 `MiMoBridge-Dev-Daemon` 按需启动；它不是最终开机自启方案。
- `127.0.0.1:3210` health `ok`，MCP `ready`，MiMo configured，队列为空。
- 两个旧任务已删除；实时查看任务 `task_273ff90e443e` 已 accepted，暂留作界面示例。

### 13.2 已完成的 P4.6

- `mimo_wait_task` 用一次 daemon 内等待代替每分钟轮询，提交为 `522e7a7`。
- 变更文件：`src/tools/wait-task.ts`、`src/index.ts`、`apps/local-daemon/src/tool-context.ts`、`apps/local-daemon/src/mcp.ts`、`tests/wait-task.test.mjs`、`tests/stdio-protocol.test.mjs`。
- 根和 daemon 构建通过；正常回归 228/228（排除已知挂起测试）。
- daemon 已重启；HTTP MCP 验证 11 个工具、已结束任务立即返回、运行中任务超时仅返回最小摘要。

### 13.3 压缩后读取顺序

1. `docs/HANDOVER_STATUS.md`
2. 本文第十二、十三节
3. `docs/modules/low-token-wait.md`
4. `docs/modules/windows-launcher-portability.md`
5. `docs/OPEN_TASKS.md`

下一步：使用 P4.6 的单次等待机制下发并审查启动器任务。默认不要重读全仓。

---

**MiMo Code（Xiaomi MiMo）**  
**更新日期：2026年6月21日**
