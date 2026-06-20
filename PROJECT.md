# MiMo Bridge MCP 项目文档

> 更新日期：2026年6月20日
> 项目状态：P0-P5 核心功能可用；真实 Token 统计和审查空修改风险待完善

---

## 项目概述

MiMo Bridge MCP 是一个 MCP（Model Context Protocol）服务器，用于让 Codex 调度 MiMo Code 执行编码任务。

**核心功能**：
- Codex 负责拆解任务、设置修改边界、审查代码和最终验收
- MiMo Code 负责在指定工作区执行编码任务并返回结果
- MCP 负责传递任务、保存会话和日志、控制进程及支持多轮续接

---

## 项目阶段详解

### P0：固化当前可用版本

**目标**：把已经通过真实两轮冒烟的修复形成可回退基线

**作用**：
- 解决 MiMo CLI 需要 TTY 环境的问题（使用 node-pty）
- 解决 PTY 输出包含 ANSI 转义码的问题
- 实现 JSON 事件解析器
- 实现 `step_finish` 作为完成信号
- 实现 Windows 进程树清理

**核心模块**：
- `mimo-runner.ts` - PTY 运行器
- `event-parser.ts` - JSON 事件解析器
- `path-guard.ts` - 路径安全守卫

**验收标准**：真实 MiMo 两轮复用同一 session_id

---

### P1：任务生命周期模块

**目标**：补齐第一版六个 MCP 工具

**作用**：
- 实现完整的任务生命周期管理
- 支持任务创建、查询、回复、取消、完成
- 支持任务状态持久化

**新增工具**：
- `mimo_start_task` - 创建并后台启动任务
- `mimo_get_task` - 查询任务状态
- `mimo_reply_task` - 继续已有会话
- `mimo_cancel_task` - 终止运行任务
- `mimo_finish_task` - 标记验收/放弃
- `mimo_list_tasks` - 列出最近任务

**验收标准**：tools/list 返回六个工具，状态持久化

---

### P2：可靠性与协议测试

**目标**：把当前手工验证固化为自动化门禁

**作用**：
- Runner 集成测试（成功、非零退出、超时、取消、进程树）
- STDIO 协议测试（验证 MCP 协议正确性）
- max_rounds 边界测试（验证轮次限制）
- 共享并发拒绝测试（验证并发控制）
- MiMo CLI 版本检查

**测试覆盖**：
- 8 个 Runner 集成测试
- 4 个 STDIO 协议测试
- 3 个 max_rounds 边界测试
- 3 个并发拒绝测试
- 5 个版本检查测试

**验收标准**：84 单元测试 + 12 集成测试全部通过

---

### P3：Git Worktree 隔离与差异审计

**目标**：减少 Agent 修改主工作区的风险

**作用**：
- 每个任务创建独立 Worktree
- 任务结束后生成 Git diff 摘要
- 检测超出 `editable_paths` 的修改
- 由 Codex 审核后决定合并或丢弃

**新增工具**：
- `mimo_merge_task` - 合并/丢弃 Worktree 修改

**核心功能**：
- `GitWorktreeManager` - Worktree 管理服务
- `checkOutOfBounds()` - 越界文件检测
- `commitWorktreeChanges()` - 自动提交修改
- `mergeWorktree()` - 合并到主分支
- `discardWorktree()` - 丢弃修改

**验收标准**：23 个 git-worktree 服务测试 + 7 个 handler 测试通过

---

### P4：队列和只读并发

**目标**：支持写任务排队和只读任务并发

**作用**：
- 写任务队列：当有写任务运行时，新任务进入队列等待
- 只读任务并发：get/list 工具不受写任务限制
- 任务优先级：支持 0-10 优先级，高优先级任务优先执行
- 取消队列任务：支持取消队列中等待的任务

**新增工具**：
- `mimo_queue_status` - 查询队列状态

**核心功能**：
- `TaskQueue` - 任务队列管理类
- `enqueue()` - 入队并按优先级排序
- `cancel()` - 取消队列中的任务
- `getQueuedTasks()` - 获取队列任务信息

**验收标准**：写任务实际串行，完成、失败或取消后才释放下一任务

**当前复核**：已修复首任务绕过队列的问题；新增 6 个可控 Runner 行为测试，覆盖 start/reply 串行、重复回复拒绝、取消/失败释放以及 queued Worktree 清理，P4 行为验收通过。

---

### P4.5：Token Budget Review / 低成本审查协议

**目标**：让 Codex 默认只读取决策所需 Review Package，发现风险后才按路径升级证据。

**核心功能**：
- MiMo 完成后自动生成并持久化 Review Package
- `mimo_get_task` 支持 `summary/review/diff/focused/logs/full`
- 默认 `review`，禁止默认返回完整 diff、日志和文件内容
- diff、日志、文件和 full 均有字符预算、行数限制和截断标记
- Git 自动生成 changed files、diff stat、增删行和越界报告
- 测试失败、越界修改、任务失败等进入 `risk_flags`

**审查顺序**：Review Package → 风险检查 → 相关 diff/log/file → 显式 full 调试。

**详细协议**：`docs/modules/token-budget-review.md`

---

## 后续计划

### P5：本地管理界面与共享协作入口（已实现）

**目标**：让管理界面、Codex 和 MiMo 共用同一任务状态与执行进程。

**当前内容**：
- React 管理界面和 localhost-only 本地守护进程
- MCP Streamable HTTP `/mcp` 与固定管理 API `/api/*`
- Review-first 任务详情和“交给 Codex 审查”入口
- Codex 配置切换到 `http://127.0.0.1:3210/mcp`
- 交接指令复制失败时提供手动复制内容
- 仅允许永久删除已结束且没有 Worktree 的任务，并同步清理任务记录、brief 和日志

### P6：Web 管理界面（待规划）

**目标**：提供可视化的任务管理

**可能内容**：
- 任务列表和状态展示
- 任务详情和日志查看
- 队列管理和优先级调整
- Worktree diff 可视化

### P7：多人协作（待规划）

**目标**：支持多人共享任务队列

**可能内容**：
- 用户认证和权限管理
- 任务分配和负载均衡
- 冲突检测和解决
- 协作编辑支持

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Codex (OpenAI)                         │
│                    规划、审查、验收                           │
└─────────────────────────┬───────────────────────────────────┘
                          │ MCP Protocol
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   MiMo Bridge MCP Server                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Task Queue  │  │ Task Store  │  │ Git Worktree│         │
│  │   (P4)      │  │   (P1)      │  │   (P3)      │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ PTY Runner  │  │ Event Parser│  │ Path Guard  │         │
│  │   (P0)      │  │   (P0)      │  │   (P0)      │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────┬───────────────────────────────────┘
                          │ PTY
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     MiMo Code CLI                           │
│                   执行编码任务                                │
└─────────────────────────────────────────────────────────────┘
```

---

## MCP 工具列表（10 个）

| 工具 | 说明 | 版本 |
|------|------|------|
| `mimo_start_task` | 创建并启动任务 | P1 |
| `mimo_get_task` | 分级查询任务状态和审查证据 | P1/P4.5 |
| `mimo_reply_task` | 继续会话 | P1 |
| `mimo_cancel_task` | 终止任务或取消队列 | P1/P4 |
| `mimo_finish_task` | 标记验收/放弃 | P1 |
| `mimo_list_tasks` | 列出任务 | P1 |
| `mimo_merge_task` | 合并/丢弃 Worktree | P3 |
| `mimo_queue_status` | 查询队列状态 | P4 |
| `mimo_token_status` | 查询或重置 Token 预算状态 | P4.5 |
| `mimo_delete_task` | 永久删除已结束且没有 Worktree 的任务 | P5.1 |

---

## 测试统计

| 阶段 | 测试数 | 状态 |
|------|--------|------|
| P0 | 63 | ✅ |
| P1 | +10 | ✅ |
| P2 | +23 | ✅ |
| P3 | +30 | ✅ |
| P4 | +23 | ✅ |
| P4.5 | +31 | ✅ |
| P5/P5.1 | +8 | ✅ |
| **当前回归** | **175** | ✅（排除已知挂起的 `runner-integration.test.mjs`） |

回归中仍会出现既有的 Windows `node-pty AttachConsole failed` 输出和 `TimeoutNaNWarning`，但测试进程退出码为 0。这些作为技术债保留，不属于 P4.5 阻塞项。

---

## 提交历史

| 提交 | 内容 | 阶段 |
|------|------|------|
| `d771af8` | PTY 解析器、step_finish 完成逻辑、进程树清理 | P0 |
| `7d76caa` | cancel/finish/list 三个工具 | P1 |
| `915c2bd` | 测试与版本检查 | P2 |
| `6ae45c9` | Git Worktree 隔离与差异审计 | P3 |
| `bfe26f0` | P3 修复：Codex 审核问题 | P3 |
| `4a505e4` | 队列和只读并发 | P4 |
| `c909016` | 共享管理界面和安全任务删除 | P5/P5.1 |

---

**文档版本**：1.0  
**最后更新**：2026年6月20日
