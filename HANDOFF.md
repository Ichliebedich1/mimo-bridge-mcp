# mimo-bridge-mcp 交接文档

**更新日期：2026年6月20日**
**当前状态：P0-P3 可用；P4 已实现但队列行为审核未通过；P4.5 低成本审查协议已实现并通过自动化测试**

---

## 交接摘要

- 当前范围：P4.5 Token Budget Review。
- 目标：Codex 默认只读取小体积 Review Package，有风险时再按路径升级读取 diff、日志或文件。
- 已完成：数据结构、自动生成与持久化、六级查询、字符与日志预算、路径防护、风险标记、测试和审查规范。
- 协作依赖：P1 提供任务状态，P3 提供 Worktree 与 Git 差异；P4 队列问题独立处理。
- 当前阻塞：P4 第二个写任务虽然返回 `queued`，实际仍可能立即启动。
- 建议下一步：先修复 P4 的真实串行调度并补 runner 调用次数回归，再做一次真实 MiMo Review Package 冒烟测试。

---

## 一、当前 Git 状态

- 分支：`master`
- 本次提交范围：P4.5 源码、测试、规范及交接文档
- 提交前基线：`cdd486f 添加项目文档：P0-P4 阶段说明`

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
- P4.5 定向测试与 STDIO：20/20 通过
- 排除已知挂起的 `runner-integration.test.mjs` 后，全量回归：145/145 通过
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

## 四、MCP 工具列表（8 个）

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

1. 修复 P4 队列实际并发启动的阻塞问题
2. 用真实 MiMo 执行一次默认 Review Package 审查冒烟
3. P4 修复后再评估队列并发数配置和其他 Agent 适配器

---

**MiMo Code（Xiaomi MiMo）**  
**更新日期：2026年6月20日**
