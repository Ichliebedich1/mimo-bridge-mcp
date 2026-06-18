# mimo-bridge-mcp 交接文档

**交接日期：2026年6月18日**  
**交接方：MiMo Code（Xiaomi MiMo）**  
**接收方：Codex（OpenAI）**  
**当前状态：冒烟测试阶段，遇到关键问题**

---

## 一、已完成的工作

### 1.1 核心框架（已完成）

| 模块 | 文件 | 状态 |
|------|------|------|
| MCP 入口 | `src/index.ts` | ✅ |
| 配置管理 | `src/config.ts` | ✅ |
| 类型定义 | `src/types.ts` | ✅ |
| 任务存储 | `src/services/task-store.ts` | ✅ |
| 事件解析器 | `src/services/event-parser.ts` | ✅ |
| 路径守卫 | `src/services/path-guard.ts` | ✅ |
| 提示构建器 | `src/services/prompt-builder.ts` | ✅ |
| MiMo 运行器 | `src/services/mimo-runner.ts` | ✅（使用 PTY） |
| 共享任务注册表 | `src/services/running-tasks.ts` | ✅ |

### 1.2 MCP 工具（已完成）

| 工具 | 文件 | 状态 |
|------|------|------|
| `mimo_start_task` | `src/tools/start-task.ts` | ✅ |
| `mimo_get_task` | `src/tools/get-task.ts` | ✅ |
| `mimo_reply_task` | `src/tools/reply-task.ts` | ✅ |

### 1.3 测试（52 个测试全部通过）

| 测试文件 | 测试数量 | 状态 |
|----------|----------|------|
| `event-parser.test.mjs` | 7 | ✅ |
| `fake-mimo.test.mjs` | 8 | ✅ |
| `max-rounds.test.mjs` | 4 | ✅ |
| `path-guard.test.mjs` | 16 | ✅ |
| `prompt-builder.test.mjs` | 5 | ✅ |
| `running-tasks.test.mjs` | 4 | ✅ |
| `task-store.test.mjs` | 8 | ✅ |

### 1.4 Codex MCP 配置（已完成）

已在 `~/.codex/config.toml` 中添加：

```toml
[mcp_servers.mimo_bridge]
command = 'C:\Program Files\nodejs\node.exe'
args = ['C:\Users\86172\Desktop\MiMo Code project\Agent 协作项目\mimo-bridge-mcp\dist\index.js']
startup_timeout_sec = 10
tool_timeout_sec = 30
enabled = true

[mcp_servers.mimo_bridge.env]
MIMO_NODE_PATH = 'D:\AI\Mimo2 Codex\.tools\node-v22.22.3-win-x64\node.exe'
MIMO_ENTRY_PATH = 'D:\AI\Mimo2 Codex\.tools\node-v22.22.3-win-x64\node_modules\@mimo-ai\cli\bin\mimo'
MIMO_ALLOWED_ROOTS = 'C:\Users\86172\Desktop'
MIMO_RUNTIME_DIR = 'C:\Users\86172\Desktop\MiMo Code project\Agent 协作项目\mimo-bridge-mcp\runtime'
```

---

## 二、关键发现

### 2.1 MiMo 需要 TTY

**问题**：MiMo CLI 在没有 TTY 的环境下无法正常运行，进程会立即退出。

**验证**：
- 直接运行 `mimo.cmd run` 正常 ✅
- 使用 `spawn` 启动 MiMo 进程立即退出 ❌
- 使用 `node-pty` 创建 PTY 后 MiMo 正常运行 ✅

**解决方案**：使用 `node-pty` 包代替 `child_process.spawn`。

### 2.2 PTY 输出包含 ANSI 转义码

**问题**：PTY 输出包含大量 ANSI 转义码（如 `[2J[m[H`、`[K` 等），干扰 JSON 解析。

**解决方案**：使用 `extractJson` 函数，通过查找 `{` 和 `}` 来提取 JSON 对象，而不是尝试剥离 ANSI 码。

---

## 三、当前遇到的问题

### 3.1 P1：sessionID 未被提取（阻断问题）

**现象**：
- MiMo 进程正常运行并输出 JSON 事件
- 日志文件中有完整的 JSON 事件，包含 `sessionID`
- 但 `mimo_get_task` 返回的 `session_id` 为 `null`
- 任务最终状态为 `failed`，错误信息："MiMo 未返回 sessionID"

**日志示例**：
```json
{"type":"step_start","timestamp":1781716393288,"sessionID":"ses_1296d748affekcgENEfdQU2lel","part":{"id":"prt_ed6929d45001nbEAzxD9dndhUo","messageID":"msg_ed6928fdc001LAH0M5uK6vrZX5","sessionID":"ses_1296d748affekcgENEfdQU2lel","type":"step-start"}}
```

**可能原因**：
1. 事件解析器没有正确解析 PTY 输出
2. PTY 输出被分割成多行，解析器无法正确处理
3. `processLine` 函数没有被正确调用

**调试状态**：
- 已确认日志文件中有完整的 JSON 事件
- 已确认 `extractJson` 函数可以正确提取 JSON
- 需要进一步调试 `processLine` 函数的调用流程

### 3.2 P2：进程退出检测不准确

**现象**：
- MiMo 进程已退出，但 `onExit` 事件未触发
- 使用定时器检测进程退出，但检测逻辑可能不准确

**当前解决方案**：
- 使用 `noDataCount` 检测进程是否已停止输出
- 当 3 秒内没有新数据时，认为进程已退出

---

## 四、代码修改记录

### 4.1 最新提交

**提交编号**：`6cb49a6`  
**提交信息**：fix: fix all issues from eighth review  
**修改内容**：
- 添加 `stderr_log_path` 字段持久化
- 修复 `timeout` 和 `cancel` 假场景

### 4.2 未提交的修改

当前工作目录有未提交的修改：
- `src/services/mimo-runner.ts`：使用 PTY 代替 spawn
- `src/services/event-parser.ts`：使用 `extractJson` 函数
- `tests/debug-mcp.mjs`：调试脚本
- `tests/debug-pty.mjs`：PTY 调试脚本
- `tests/test-strip.mjs`：ANSI 剥离测试脚本

---

## 五、下一步工作

### 5.1 优先级 P1：修复 sessionID 提取

**任务**：
1. 调试 `processLine` 函数，确认它被正确调用
2. 确认 `extractJson` 函数在解析器中正常工作
3. 添加调试日志，跟踪 JSON 解析流程
4. 修复 sessionID 提取问题

### 5.2 优先级 P2：完善进程退出检测

**任务**：
1. 研究 `node-pty` 的 `onExit` 事件为何不触发
2. 改进进程退出检测逻辑
3. 确保任务状态正确更新

### 5.3 优先级 P3：完成冒烟测试

**任务**：
1. 修复 sessionID 提取问题
2. 测试完整的两轮对话流程
3. 验证 `mimo_reply_task` 功能
4. 记录测试结果

---

## 六、文件清单

### 6.1 核心文件

```
mimo-bridge-mcp/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── types.ts
│   └── services/
│       ├── task-store.ts
│       ├── event-parser.ts
│       ├── path-guard.ts
│       ├── prompt-builder.ts
│       ├── mimo-runner.ts
│       └── running-tasks.ts
└── tests/
    ├── fixtures/
    │   └── fake-mimo.mjs
    ├── event-parser.test.mjs
    ├── fake-mimo.test.mjs
    ├── max-rounds.test.mjs
    ├── path-guard.test.mjs
    ├── prompt-builder.test.mjs
    ├── running-tasks.test.mjs
    ├── task-store.test.mjs
    ├── debug-mcp.mjs
    ├── debug-pty.mjs
    └── test-strip.mjs
```

### 6.2 配置文件

```
~/.codex/config.toml  # 已添加 mimo_bridge 配置
```

### 6.3 运行时目录

```
mimo-bridge-mcp/runtime/
├── tasks/      # 任务状态 JSON
├── briefs/     # 任务说明 Markdown
├── logs/       # 执行日志 JSONL
└── debug-mcp/  # 调试测试目录
```

---

## 七、Git 状态

**当前分支**：master  
**最新提交**：`6cb49a6`  
**工作目录状态**：有未提交的修改（PTY 相关修改）

---

## 八、环境信息

- **操作系统**：Windows 10
- **Node.js**：v24.16.0
- **MiMo Node.js**：v22.22.3
- **MiMo CLI**：0.1.1
- **MCP SDK**：@modelcontextprotocol/sdk@1.29.0
- **Zod**：4.4.3

---

## 九、联系信息

**MiMo Code（Xiaomi MiMo）**  
**交接日期：2026年6月18日**

如有问题，请查阅：
- 设计文档：`C:\Users\86172\Desktop\MiMo Code project\Agent 协作项目\Codex与Mimo多Agent协作方案.md`
- 代码仓库：`C:\Users\86172\Desktop\MiMo Code project\Agent 协作项目\mimo-bridge-mcp`

---

## 十、Codex 处理结果

**处理方：Codex（OpenAI）**
**处理日期：2026年6月18日**
**状态：P1 sessionID 提取和 P2 完成检测已修复，真实 MiMo 两轮冒烟通过**

### 10.1 根因

1. PTY 使用 80 列宽时会把 JSON 事件硬换行，导致字段名和字符串中出现真实换行，原解析器无法执行 `JSON.parse`。
2. 原 runner 把“连续数秒没有输出”误判为进程退出。真实 MiMo 首个事件可能在约 6 秒后才出现，任务已经被提前标记失败。
3. MiMo 在 PTY 下不一定及时触发 `onExit`，但会输出明确的 `step_finish` JSON 事件。
4. 假 MiMo 的 `malformed` 场景输出无效行后立即退出，没有继续输出有效事件。
5. 两个假 MiMo 测试文件共用同一临时目录，并行执行时存在互相删除目录的竞态。

### 10.2 修复

- `event-parser.ts` 改为从连续数据流中提取完整、括号平衡的 JSON 对象，不再依赖换行。
- 支持 ANSI 前后缀、多个 JSON 对象同块输出、分片输出以及 PTY 软换行恢复。
- PTY 列宽从 80 调整为 10000，降低终端硬换行概率。
- 删除“无输出即完成”的启发式判断，只使用正式超时、`onExit` 和 `step_finish`。
- 收到 `step_finish` 后立即形成任务结果，并使用参数化 `taskkill /T /F /PID` 清理 Windows 进程树。
- 修复假 MiMo `malformed` 场景，并隔离场景测试的临时目录。

### 10.3 验证结果

- `npm.cmd run build`：通过。
- `npm.cmd test`：63/63 通过。
- 假 MiMo MCP 两轮：通过，首轮和续接复用同一 `session_id`。
- 真实 MiMo 首轮：进入 `review`，成功保存真实 `session_id` 和日志路径。
- 真实 MiMo 两轮：通过，两轮均为 `review`，复用会话 `ses_12954d124ffeDULhcwfGA8NCu5`，第二轮返回 `CONTINUED`。

当前修复尚未提交，工作区中的代码和本节文档为 Codex 本次修改。
