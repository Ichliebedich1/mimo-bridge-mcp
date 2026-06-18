# mimo-bridge-mcp 交接文档

**更新日期：2026年6月19日**  
**当前状态：P0/P1 已完成，P2 功能已实现；带已登记技术债进入第一版落地**

---

## 一、当前 Git 状态

- 分支：`master`
- 工作区：`HANDOFF.md` 有本次未提交的技术债文档更新；源码无未提交修改
- 最新提交：`833db96 更新交接文档：P2 完成状态`

| 提交 | 内容 |
|------|------|
| `d771af8` | P0 固化版本 |
| `7d76caa` | P1 任务生命周期 |
| `915c2bd` | P2 可靠性与协议测试 |
| `833db96` | P2 交接文档更新 |

---

## 二、测试验证状态

- `npm.cmd run build`：通过
- 排除 `runner-integration.test.mjs` 后：88/88 通过
- `stdio-protocol.test.mjs`：4/4 通过
- 完整 `npm.cmd test`：Codex 独立复核超过 150 秒仍未退出，卡在 `runner-integration.test.mjs`
- `runner-integration.test.mjs` 在 Node.js 22 和 24 下均可复现挂起，因此不能记录为“96/96 已通过”
- P0 的真实 MiMo 两轮续接冒烟此前已通过，当前未发现生产主流程回归

---

## 三、P2 完成内容

### 3.1 Runner 集成测试（8 个）

文件：`tests/runner-integration.test.mjs`

| 测试 | 说明 |
|------|------|
| success | PTY 成功完成 step_finish |
| exit_error | 非零退出码 |
| timeout | 超时场景 |
| malformed | 无效 JSON 后继续有效输出 |
| fragmented | 碎片化 JSON 输出 |
| stderr | stderr 输出 |
| continue | 续接会话 |
| process tree | 进程树终止 |

### 3.2 STDIO 协议测试（4 个）

文件：`tests/stdio-protocol.test.mjs`

| 测试 | 说明 |
|------|------|
| tools/list | 返回 6 个工具 |
| mimo_list_tasks | 空列表 |
| mimo_get_task | 不存在任务 |
| mimo_cancel_task | 取消运行中任务 |

### 3.3 max_rounds 工具层边界测试（3 个）

文件：`tests/reply-max-rounds.test.mjs`

| 测试 | 说明 |
|------|------|
| max_rounds=1 | 达到上限拒绝 |
| max_rounds=2 | 达到上限拒绝 |
| max_rounds=5 | 达到上限拒绝 |

### 3.4 共享并发拒绝测试（3 个）

文件：`tests/concurrent-reject.test.mjs`

| 测试 | 说明 |
|------|------|
| start 并发拒绝 | 已有任务运行时拒绝新任务 |
| reply 并发拒绝 | 已有任务运行时拒绝回复 |
| 任务完成后允许新任务 | 任务完成后可启动新任务 |

### 3.5 MiMo CLI 版本检查（5 个）

文件：`tests/mimo-version.test.mjs`

| 测试 | 说明 |
|------|------|
| Node.js 版本检查 | checkNodeVersion |
| MiMo CLI 版本检查 | checkMimoCliVersion |
| 组合版本检查 | checkMimoVersion |
| 无效 node 路径 | 抛出错误 |
| 无效 entry 路径 | 抛出错误 |

### 3.6 代码修改

| 文件 | 修改内容 |
|------|----------|
| `src/config.ts` | 添加 checkNodeVersion/checkMimoCliVersion/checkMimoVersion 函数 |
| `tests/fixtures/fake-mimo.mjs` | 支持 --version 参数 |

---

## 四、技术债清单（第一版接受）

第一版决策：保持单机、单用户、一次一个写任务，并由用户/Codex 人工监督。以下问题均已登记，暂不阻塞第一版落地；P3/P4 属于后续功能，不计入技术债。

| ID | 技术债 | 影响 | 第一版处理 | 后续修复方向 |
|----|--------|------|------------|--------------|
| TD-01 | `TaskStore.listTasks` 按随机文件名倒序，而不是按 `updated_at` 倒序 | 任务较多时“最近任务”可能不准确 | 接受；第一版任务量小，可用任务 ID 查询 | 读取任务后按 `updated_at` 排序，再执行 `limit`，补确定性测试 |
| TD-02 | `cancel-task.test.mjs` 使用独立 `RunningTaskRegistry`，未覆盖正式处理器的 `globalRunningTasks` | 单元测试可能漏掉取消回调回归 | 接受；STDIO 取消测试和真实取消路径已通过 | 注入 registry 或直接使用生产共享实例，验证回调和进程终止 |
| TD-03 | `runner-integration.test.mjs` 会挂起并残留 PTY/子进程，导致完整 `npm test` 不退出 | 自动测试门禁不可靠，可能误报“全部通过” | 接受但不得再宣称 96/96；发布前运行其余 88 项和人工冒烟 | 确保每个测试清理 timer、PTY 和进程树，并给测试设置硬超时 |
| TD-04 | 所谓 Runner 集成测试直接调用 `node-pty`，没有调用生产 `runMimoTask` | 测试通过也不能证明真实 Runner 的解析、超时和完成逻辑正确 | 接受；依赖 P0 真实 MiMo 冒烟和现有单元测试 | 改为通过生产 Runner 入口驱动 fake MiMo，覆盖成功、失败、超时、取消和续接 |
| TD-05 | “process tree” 测试最后使用无条件 `assert.ok(true)` | 即使子进程未终止，测试仍会通过 | 接受；第一版保持人工监督 | 记录子 PID，终止后查询进程不存在，并在失败时强制清理 |
| TD-06 | Windows `node-pty` 偶发输出 `AttachConsole failed` | 测试日志嘈杂，升级 Node.js 后可能出现兼容问题 | 接受；当前主功能可用 | 固定验证过的 Node.js/node-pty 组合，升级后执行真实冒烟 |
| TD-07 | 部分测试直接调用 handler，绕过 Zod 默认值，出现 `TimeoutNaNWarning` | 测试不能准确模拟 MCP 入参处理，可能掩盖默认值问题 | 接受；正式 MCP 路径会应用 schema | handler 内补防御性默认值，测试显式传入超时或经 schema 解析 |
| TD-08 | MiMo CLI 版本检查只读取版本字符串，没有校验兼容版本范围 | 不兼容的新版本仍可能通过启动检查 | 接受；第一版固定当前 MiMo CLI 0.1.1 | 增加语义版本解析、支持范围和明确错误信息 |
| TD-09 | MiMo 与 Codex 的 MCP 配置格式不同，缺少导入前校验和自动回滚 | 错误写入 `mcp.servers` 会导致 MiMo 无法启动 | 接受；第一版禁止直接复制配置，当前 MiMo 配置保持 `mcp: {}` | 增加格式转换、启动前校验和备份恢复流程 |

### 第一版发布边界

- 可发布：六个 MCP 工具、单写任务生命周期、PTY Runner、任务持久化和多轮续接。
- 必须保留：人工审查、路径边界、一次一个写任务、发布前真实 MiMo 冒烟。
- 不承诺：无人值守运行、多人共享、任务队列、只读并发、自动 Worktree 合并。

---

## 五、下一步工作

### P3：Git Worktree 隔离与差异审计

1. 每个任务创建独立 Worktree
2. 任务结束后生成 Git diff 摘要
3. 检测超出 `editable_paths` 的修改
4. 由 Codex 审核后决定合并或丢弃

### P4：队列和只读并发

- 写任务队列
- 只读任务并发
- 任务优先级和取消队列

---

## 六、文件清单

```
mimo-bridge-mcp/
├── src/
│   ├── index.ts
│   ├── config.ts                  # 添加版本检查函数
│   ├── types.ts
│   └── services/
│       ├── task-store.ts
│       ├── event-parser.ts
│       ├── path-guard.ts
│       ├── prompt-builder.ts
│       ├── mimo-runner.ts
│       └── running-tasks.ts
├── tests/
│   ├── fixtures/
│   │   └── fake-mimo.mjs          # 支持 --version
│   ├── cancel-task.test.mjs
│   ├── concurrent-reject.test.mjs  # P2 新增
│   ├── event-parser.test.mjs
│   ├── fake-mimo.test.mjs
│   ├── fake-mimo-scenarios.test.mjs
│   ├── finish-task.test.mjs
│   ├── list-tasks.test.mjs
│   ├── max-rounds.test.mjs
│   ├── mimo-version.test.mjs      # P2 新增
│   ├── path-guard.test.mjs
│   ├── prompt-builder.test.mjs
│   ├── reply-max-rounds.test.mjs  # P2 新增
│   ├── runner-integration.test.mjs # P2 新增
│   ├── running-tasks.test.mjs
│   ├── stdio-protocol.test.mjs    # P2 新增
│   └── task-store.test.mjs
└── runtime/
    ├── tasks/
    ├── briefs/
    └── logs/
```

---

## 七、恢复上下文时先读

1. `../Codex与Mimo多Agent协作方案.md`：总体方案和 P0-P4 路线
2. 本文档：P2 完成状态和测试详情
3. `git log --oneline -5` 与 `git status --short --branch`：确认外部修改

---

**MiMo Code（Xiaomi MiMo）**  
**更新日期：2026年6月19日**
