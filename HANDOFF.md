# mimo-bridge-mcp 交接文档

**更新日期：2026年6月19日**  
**当前状态：P0 已完成，P1 已完成，P2 已完成**

---

## 一、当前 Git 状态

- 分支：`master`
- 工作区：干净
- 最新提交：`915c2bd feat: P2 可靠性与协议测试`

| 提交 | 内容 |
|------|------|
| `d771af8` | P0 固化版本 |
| `7d76caa` | P1 任务生命周期 |
| `915c2bd` | P2 可靠性与协议测试 |

---

## 二、测试验证状态

- `npm.cmd run build`：通过
- `npm.cmd test`：84/84 单元测试通过
- 12 个集成测试全部通过（runner-integration 8 个，stdio-protocol 4 个）
- 总计 96 个测试全部通过

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

## 四、已知问题

1. `TaskStore.listTasks` 排序问题：当前按文件名倒序，不是按 `updated_at` 倒序
2. `cancel-task.test.mjs` 使用独立 `RunningTaskRegistry`，未验证真正的取消回调
3. PTY 的 `AttachConsole failed` 错误：Windows 环境下 node-pty 的已知问题，不影响功能

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
