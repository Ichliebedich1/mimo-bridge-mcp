# mimo-bridge-mcp 交接文档

**更新日期：2026年6月19日**  
**当前状态：P0/P1 已完成，P2 带已登记技术债；P3 第一次审核未通过，等待修复**

---

## 一、当前 Git 状态

- 分支：`master`
- 工作区：`HANDOFF.md` 有本次未提交审核记录；源码无未提交修改
- 最新提交：`5e62d57 更新交接文档：P3 完成状态`

| 提交 | 内容 |
|------|------|
| `d771af8` | P0 固化版本 |
| `7d76caa` | P1 任务生命周期 |
| `915c2bd` | P2 可靠性与协议测试 |
| `833db96` | P2 交接文档 |
| `6ae45c9` | P3 Git Worktree 隔离与差异审计 |
| `5e62d57` | P3 交接文档更新 |

---

## 二、测试验证状态

- `npm.cmd run build`：通过
- `tests/git-worktree.test.mjs`：11/12 通过；1 项因硬编码写入 `C:\Windows\Temp` 触发 `EPERM`
- 完整 `npm.cmd test` 未作为本轮通过依据：P2 已登记的 `runner-integration.test.mjs` 仍会挂起
- Codex 最小复现：未跟踪新增文件未进入 diff/越界清单
- Codex 最小复现：未提交的 Worktree 修改执行 merge 后主分支内容未变化，随后删除脏 Worktree 失败

---

## 三、P3 已实现内容（待修复）

### 3.1 Git Worktree 服务

文件：`src/services/git-worktree.ts`

| 方法 | 说明 |
|------|------|
| `isGitRepo()` | 检查是否为 Git 仓库 |
| `getCurrentCommit()` | 获取当前 commit hash |
| `createWorktree(taskId)` | 创建独立 Worktree |
| `removeWorktree(taskId)` | 删除 Worktree |
| `getDiff(taskId)` | 获取 diff 内容 |
| `getDiffStat(taskId)` | 获取 diff 统计 |
| `getChangedFiles(taskId)` | 获取变更文件列表 |
| `getDiffSummary(taskId, editablePaths)` | 获取 diff 摘要 |
| `checkOutOfBounds(...)` | 检测超出 editable_paths 的修改 |
| `mergeWorktree(taskId)` | 合并 Worktree 到主分支 |
| `discardWorktree(taskId)` | 丢弃 Worktree 和分支 |

### 3.2 Merge Task 工具

文件：`src/tools/merge-task.ts`

- 支持 `merge` 操作：合并 Worktree 到主分支
- 支持 `discard` 操作：丢弃 Worktree 和分支
- 合并前检查超出路径的修改

### 3.3 Start Task 修改

文件：`src/tools/start-task.ts`

- 新增 `use_worktree` 参数（默认 true）
- 自动创建 Worktree（如果 workspace 是 Git 仓库）
- 任务完成后自动获取 diff 摘要

### 3.4 测试覆盖

文件：`tests/git-worktree.test.mjs`

| 测试 | 说明 |
|------|------|
| isGitRepo | 检查 Git 仓库 |
| isGitRepo non-git | 非 Git 目录 |
| getCurrentCommit | 获取 commit hash |
| createWorktree | 创建 Worktree |
| createWorktree duplicate | 重复创建抛错 |
| getChangedFiles | 检测变更文件 |
| getDiffStat | 获取 diff 统计 |
| checkOutOfBounds | 检测超出路径 |
| checkOutOfBounds empty | 空 editablePaths |
| getDiffSummary | 获取 diff 摘要 |
| removeWorktree | 删除 Worktree |
| discardWorktree | 丢弃 Worktree 和分支 |

---

## 四、Codex P3 修复申请（阻塞 P3 通过）

### 4.1 修复目标

P3 必须保证：任务只在独立 Worktree 中修改；所有变更都能被审计；超出 `editable_paths` 的修改不能合并；允许的修改能够真实进入任务原仓库。任何隔离失败都必须停止任务，不能静默回退主工作区。

### 4.2 必修问题与实现要求

#### P3-01：任务完成后越界审计没有执行

- 位置：`src/tools/start-task.ts` 的完成回调。
- 原因：`taskStore.updateTaskWorktree(...)` 只更新磁盘状态，局部变量 `task.worktree` 仍为 `null`；后续 `if (task.worktree)` 永远为假。
- 修改：创建 Worktree 后保存 `worktreeInfo` 局部变量，或在完成回调中重新 `taskStore.getTask(task_id)`；不得依赖创建任务时的旧对象。
- 修改：任务完成后必须持久化最新 `diff_summary`、`out_of_bounds_files` 和 `has_out_of_bounds_changes`。

#### P3-02：变更收集漏掉未跟踪、已暂存和已提交文件

- 位置：`src/services/git-worktree.ts` 的 `getDiff`、`getDiffStat`、`getChangedFiles`。
- 原因：普通 `git diff` 只覆盖部分未暂存修改。
- 修改：以任务保存的 `base_commit` 为基线，同时收集以下状态并去重：
  - `base_commit..HEAD` 中的已提交修改；
  - index 中的已暂存修改；
  - working tree 中的未暂存修改；
  - `git status --porcelain=v1 -z` 中的未跟踪文件和重命名。
- 修改：状态解析必须正确处理空格、中文文件名、重命名和删除。
- 修改：越界审计至少必须覆盖所有变更文件名；不能因为文件还未被 Git 跟踪就忽略。

#### P3-03：`editable_paths` 映射到 Worktree 的方式不完整

- 位置：`GitWorktreeManager.checkOutOfBounds(...)`。
- 原因：`editable_paths` 可以是相对路径或原工作区内的绝对路径；绝对路径直接 `resolve(worktreePath, absolutePath)` 会继续指向原工作区。
- 修改：先以原始 `workspace_path` 为基准把每个可编辑路径转换成仓库相对路径，再与 Worktree 内的变更路径比较。
- 修改：继续使用目录边界比较，不能用不带分隔符的字符串前缀判断。

#### P3-04：未提交修改不能真正合并

- 位置：`GitWorktreeManager.mergeWorktree(...)` 和 `src/tools/merge-task.ts`。
- 原因：任务分支仍指向 `base_commit` 时，`git merge` 不会包含 Worktree 中的未提交修改；随后普通 `worktree remove` 会因脏目录失败。
- 修改建议：
  1. 合并前重新执行完整 diff 和越界审计，不能只信任任务完成时保存的旧结果。
  2. 若存在允许范围内的未提交修改，在任务 Worktree 中执行 `git add -A` 并创建任务提交；提交信息使用可审计格式，例如 `mimo(<task_id>): apply task changes`。
  3. 若 MiMo 已产生提交，则保留这些提交并基于 `base_commit` 检查完整变更。
  4. 合并冲突时执行 `git merge --abort`，保留 Worktree、分支和任务元数据，返回明确错误。
  5. 只有合并成功后才能删除 Worktree、删除任务分支并清除 `task.worktree`。
- 禁止：使用 `--force` 删除尚未成功合并的修改。

#### P3-05：合并工具可能操作错误仓库和错误目标分支

- 位置：`src/index.ts` 和 `src/tools/merge-task.ts`。
- 原因：当前固定使用 `config.allowedRoots[0]`，不是任务自己的仓库；目标分支还硬编码为 `master`。
- 修改：合并时从任务状态读取原始 `task.config.workspace_path`，并验证它与保存的 Worktree 属于同一个 Git common dir。
- 修改：创建任务时保存 `base_branch`，合并回该分支；兼容 `main`、`master` 和用户当前分支。
- 修改：合并前检查目标工作区是否有未提交修改；若不干净则拒绝，不得自动覆盖或切换。

#### P3-06：隔离失败时静默回退主工作区

- 位置：`src/tools/start-task.ts` 创建 Worktree 的 `catch`。
- 原因：创建失败后仍调用 Runner，并把 `workspace_path` 保持为原仓库。
- 修改：当 `use_worktree=true` 时，非 Git 仓库或 Worktree 创建失败必须返回错误并标记任务失败，不能启动 MiMo。
- 修改：只有调用方明确传入 `use_worktree=false` 时，才允许使用原工作区。
- 临时措施：修复和验收完成前，将 `use_worktree` 默认值设为 `false`，避免第一版默认进入未验证路径；P3 通过后再改回 `true`。

#### P3-07：Worktree 目录污染目标仓库

- 位置：`GitWorktreeManager` 的 `.worktrees` 路径策略。
- 现象：创建 Worktree 后，目标仓库 `git status --porcelain` 出现 `?? .worktrees/`。
- 修改：优先把 Worktree 放到 MCP `runtimeDir/worktrees/<repo-id>/<task-id>`，并把实际路径完整保存到任务状态；不要依赖根据 task ID 重新拼接路径。
- 验收：创建 Worktree 后，原仓库状态必须与创建前一致。

#### P3-08：测试路径和覆盖不足

- 位置：`tests/git-worktree.test.mjs`。
- 修改：不要写死 `C:\Windows\Temp`；使用 `node:os.tmpdir()` 或测试目录。
- 修改：测试清理必须放在可靠的 `after`/`finally` 中，失败时也不能残留 Worktree 和分支。
- 修改：补齐下面的端到端测试，不要只测试服务方法。

### 4.3 必须新增的回归测试

1. `start_task` 成功创建 Worktree，并确认 Runner 收到的是 Worktree 路径。
2. Worktree 创建失败时任务失败，Runner 没有启动，原工作区没有改动。
3. 未暂存、已暂存、未跟踪、已提交和重命名文件均进入变更清单。
4. 相对和绝对 `editable_paths` 均能正确映射，越界文件被准确识别。
5. 任务结束后，越界结果真实写回 TaskStore。
6. 任务结束后再新增越界文件，merge 时重新审计并拒绝。
7. 未提交的允许范围修改执行 merge 后，目标分支文件内容真实变化。
8. 合并冲突时保留 Worktree 和任务分支，不清除任务元数据。
9. discard 能删除 Worktree 和任务分支，但不影响原仓库其他分支和未提交修改。
10. 多个 `allowedRoots` 时，merge 操作任务自己的仓库，不操作第一个根目录。
11. 默认分支为 `main` 和 `master` 时均能正确合并。
12. 创建 Worktree 前后，原仓库 `git status --porcelain` 保持一致。

### 4.4 P3 验收条件

- `npm.cmd run build` 通过。
- P3 新增测试全部通过，不依赖管理员权限。
- 排除已登记的 P2 Runner 挂起测试后，其余测试全部通过。
- 真实执行一次 `start_task -> 生成修改 -> 越界审计 -> merge`，确认修改进入正确仓库和正确分支。
- 真实执行一次越界修改，确认 merge 被拒绝。
- 测试结束后 `git worktree list`、任务分支和临时目录无残留。
- Codex 二次审核通过前，不得把 P3 标记为完成，也不要开始 P4。

---

## 五、MCP 工具列表

| 工具 | 说明 | P3 新增 |
|------|------|---------|
| `mimo_start_task` | 创建并启动任务 | 修改 |
| `mimo_get_task` | 查询任务状态 | |
| `mimo_reply_task` | 继续会话 | |
| `mimo_cancel_task` | 终止任务 | |
| `mimo_finish_task` | 标记验收/放弃 | |
| `mimo_list_tasks` | 列出任务 | |
| `mimo_merge_task` | 合并/丢弃 Worktree | 新增，待修复验收 |

---

## 六、下一步工作

### 当前唯一优先事项：修复 P3

- 按第四节逐项修改并补回归测试。
- 提交修复代码和更新后的测试证据。
- 等待 Codex 二次审核。

### P4：队列和只读并发（暂缓）

- 写任务队列
- 只读任务并发
- 任务优先级和取消队列

---

## 附录：P2 历史交接快照（仅供追溯）

以下内容保留此前 P2 交接记录，不代表当前执行状态。MiMo 本轮只执行第四节 P3 修复申请，不要按附录中的“下一步工作”启动 P3 或 P4。

**MiMo Code（Xiaomi MiMo）**  
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
