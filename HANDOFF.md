# mimo-bridge-mcp 交接文档

**更新日期：2026年6月19日**  
**当前状态：P0/P1 可用，P2 带已登记技术债；P3 已由 Codex 修复并通过自动化验收，默认开关仍保持关闭等待受控启用**

---

## 一、当前 Git 状态

- 分支：`master`
- 工作区：本轮 P3 修复、测试和交接文档均为未提交修改
- 最新提交：`5505afc 更新交接文档：P3 修复完成，等待 Codex 二次审核`

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

---

## 二、测试验证状态

- `npm.cmd run build`：通过
- P3 git-worktree 服务测试：23/23 通过
- P3 真实 handler 测试：7/7 通过
- STDIO 协议测试：5/5 通过，包含 7 工具列表和 `mimo_merge_task` 调用路由
- 排除已知挂起的 `runner-integration.test.mjs` 后：119/119 通过
- 回归仍会输出已登记的 `node-pty AttachConsole failed` 和 `TimeoutNaNWarning`，但本轮测试进程正常退出且不影响断言结果

---

## 三、P3 修复内容（Codex 审核问题）

### 3.1 修复清单

| 问题 | 修复内容 |
|------|----------|
| P3-01 | 修复完成回调中 task.worktree 问题，改为保存 worktreeState 局部变量 |
| P3-02 | 修复变更收集：使用 `git status --porcelain=v1 -z` 收集未跟踪、已暂存、已提交和重命名文件 |
| P3-03 | 修复 editable_paths 映射：先转换为相对路径再比较 |
| P3-04 | 修复合并：自动提交未修改，合并冲突时 abort 并保留 Worktree |
| P3-05 | 修复合并工具：从任务状态读取 workspace_path，使用当前分支作为目标分支 |
| P3-06 | 修复隔离失败时返回错误，不启动 MiMo；`use_worktree` 默认改为 `false` |
| P3-07 | 修复 Worktree 路径：放到 `runtimeDir/worktrees` 下，不污染目标仓库 |
| P3-08 | 修复测试：使用 `os.tmpdir()`，补齐端到端测试 |

### 3.2 测试覆盖（21 个 git-worktree 测试）

| 测试 | 说明 |
|------|------|
| isGitRepo | 检查 Git 仓库 |
| isGitRepo non-git | 非 Git 目录 |
| getCurrentCommit | 获取 commit hash |
| getCurrentBranch | 获取分支名 |
| createWorktree | 创建 Worktree |
| createWorktree duplicate | 重复创建抛错 |
| createWorktree not pollute | 不污染原仓库 |
| getChangedFiles untracked | 检测未跟踪文件 |
| getChangedFiles staged | 检测已暂存文件 |
| getChangedFiles committed | 检测已提交文件（通过 diff） |
| getChangedFiles deleted | 检测已删除文件 |
| getDiffStat | 获取 diff 统计 |
| checkOutOfBounds relative | 相对路径越界检测 |
| checkOutOfBounds absolute | 绝对路径越界检测 |
| checkOutOfBounds empty | 空 editablePaths |
| getDiffSummary | 获取 diff 摘要 |
| commitWorktreeChanges | 提交修改 |
| mergeWorktree | 合并提交的修改 |
| mergeWorktree conflicts | 合并冲突处理 |
| removeWorktree | 删除 Worktree |
| discardWorktree | 丢弃 Worktree 和分支 |

---

## 四、MCP 工具列表

| 工具 | 说明 | 状态 |
|------|------|------|
| `mimo_start_task` | 创建并启动任务 | ✅ 已修复 |
| `mimo_get_task` | 查询任务状态 | ✅ |
| `mimo_reply_task` | 继续会话 | ✅ |
| `mimo_cancel_task` | 终止任务 | ✅ |
| `mimo_finish_task` | 标记验收/放弃 | ✅ |
| `mimo_list_tasks` | 列出任务 | ✅ |
| `mimo_merge_task` | 合并/丢弃 Worktree | ✅ 已修复 |

---

## 五、关键配置变更

- `use_worktree` 默认值：`false`（P3 通过验收后再改回 `true`）
- Worktree 路径：`runtimeDir/worktrees/<repo-id>/<task-id>`（不污染目标仓库）

---

## 六、下一步工作

### P3 受控启用

- 保持 `use_worktree=false` 作为默认发布保护，不影响 P0-P2 第一版。
- 先执行一次人工监督的真实 MiMo `use_worktree=true` 任务，再决定是否把默认值改为 `true`。

### P4：队列和只读并发

- 写任务队列
- 只读任务并发
- 任务优先级和取消队列

---

**MiMo Code（Xiaomi MiMo）**  
**更新日期：2026年6月19日**

---

## 七、Codex 第二次审核结果与接管计划

### 7.1 已确认完成的部分

- `use_worktree` 默认值已改为 `false`，不会让第一版默认进入未验证流程。
- Worktree 创建失败时已经改为返回错误，不再静默回退主工作区。
- Worktree 目录已移到 `runtimeDir/worktrees/<repo-id>/<task-id>`，不再污染目标仓库。
- 未跟踪、已暂存和已删除文件的基础识别已加入。
- Worktree 自动提交和 merge conflict abort 的服务层逻辑已加入。
- P3 服务层测试 21/21 通过。

### 7.2 第二次审核仍存在的核心问题

#### P3-R1：Manager 使用的 Worktree 根目录不一致

- 创建阶段：`start-task.ts` 使用 `new GitWorktreeManager(workspace, config.runtimeDir)`。
- 完成回调：重新创建 Manager 时遗漏 `config.runtimeDir`，会转而查找仓库内 `.worktrees`。
- merge/discard：`merge-task.ts` 同样遗漏 runtime 根目录。
- 影响：任务完成后拿不到 diff 摘要；实际 `mimo_merge_task` 无法找到 Worktree。
- 修改：不要重新推算 Worktree 路径。优先让 Manager 方法接收任务中保存的 `worktree_path`，或统一注入同一个 `worktreesBaseDir`；start、完成回调、merge、discard 必须使用同一来源。

#### P3-R2：新路径被旧安全检查无条件拒绝

- `merge-task.ts` 要求路径包含 `.worktrees`，但当前新路径是 `runtimeDir/worktrees/...`。
- Codex 最小复现：真实 merge handler 直接返回 `Worktree 路径异常，安全检查失败`。
- 影响：merge 和 discard 两种操作都不可用。
- 修改：删除字符串包含判断；使用 `realpath`/`relative` 验证保存的 Worktree 位于配置的 runtime worktrees 根目录，并通过 `git rev-parse --git-common-dir` 验证它属于任务原仓库。

#### P3-R3：已提交文件仍不进入越界清单

- `getChangedFiles()` 只读取 `git status --porcelain`；文件提交后工作区干净，返回空数组。
- 当前“committed”测试只直接调用原生 `git diff`，没有断言 `getChangedFiles()` 或 `getDiffSummary()` 的结果。
- Codex 最小复现：提交 `outside.txt` 后，`changedFiles` 为空，`hasOutOfBoundsChanges=false`。
- 修改：把 `base_commit..HEAD` 的 `git diff --name-status -z` 结果与 status 结果合并、去重，再交给越界审计。

#### P3-R4：审计基线使用了仓库根提交

- `getBaseCommit()` 使用 `git log --max-parents=0`，得到的是仓库最初提交，不是任务创建时保存的 `base_commit`。
- 影响：diff 摘要可能混入任务开始前的历史修改。
- 修改：删除该推断逻辑，所有审计直接使用 `task.worktree.base_commit`。

#### P3-R5：真实 handler 和协议测试缺失

- 当前 P3 测试未调用 `createStartTaskHandler`、`createMergeTaskHandler` 或 STDIO 的 `mimo_merge_task`。
- `stdio-protocol.test.mjs` 仍断言工具数为 6，实际为 7，导致回归集 108/109。
- 修改：更新工具列表断言并增加第七个工具；增加真实 handler 测试覆盖 create、完成回调审计、merge、discard、越界拒绝和错误仓库拒绝。

### 7.3 Codex 下一轮实施顺序

1. 扩展 `WorktreeState`：至少保存 `repo_path`、`worktree_path`、`base_commit`、`base_branch` 和 worktrees 根目录，避免任何路径猜测。
2. 重构 `GitWorktreeManager`：核心方法使用明确传入的保存状态，不再根据 task ID 和默认目录重建路径。
3. 合并 committed diff 与工作区 status，正确处理 `-z` 格式、重命名、中文和空格文件名。
4. 修复 start 完成回调，确保审计结果真实写回 TaskStore。
5. 重写 merge/discard handler：重新审计、验证仓库、检查目标工作区干净、合并到保存的 base branch，成功后再清理。
6. 增加真实 handler 与 STDIO 回归测试，修正 7 工具断言。
7. 运行构建、P3 定向测试、排除已知 P2 挂起项后的回归测试，再做一次真实 Worktree 冒烟。

### 7.4 完成标准

- 新增、暂存、未暂存、已提交、删除、重命名文件均进入统一审计清单。
- 相对和绝对 `editable_paths` 都能正确阻止越界合并。
- `start_task -> 修改 -> 完成审计 -> merge/discard` 真实 handler 流程通过。
- merge 后修改出现在正确仓库和正确分支；失败时不丢失 Worktree。
- 原仓库、Git worktree、任务分支和 runtime 临时目录无意外残留。
- `use_worktree` 在 Codex 验收前继续保持默认关闭。

---

## 八、Codex 修复结果与最终验收

### 8.1 已解决问题

| 编号 | 结果 |
|------|------|
| P3-R1 | `WorktreeState` 现在持久化 `repo_path`、`worktrees_root`、`worktree_path`、`base_commit`、`base_branch` 和任务分支；完成回调与 merge/discard 使用同一份状态。 |
| P3-R2 | 删除旧 `.worktrees` 字符串判断；使用可信 `runtimeDir`、`realpath/relative`、任务 ID 路径和 `git --git-common-dir` 验证 Worktree 位置及仓库归属。 |
| P3-R3 | 变更审计改为保存的 `base_commit` 到当前 Worktree 的统一 diff，并单独收集未跟踪文件；已提交文件也会进入越界检查。 |
| P3-R4 | 删除仓库根提交推断；所有完成审计和合并前复审都直接使用任务保存的 `base_commit`。 |
| P3-R5 | 新增真实 `start_task` 完成回调、merge、discard、越界拒绝、错误仓库、脏原仓库和基线分支测试；STDIO 更新为 7 工具并实际调用 merge 路由。 |
| P3-R6 | `repo-id` 从路径开头 Base64 截断改为 SHA-256 路径哈希，避免同一 Windows 用户目录下的不同仓库共用 Worktree 根目录。 |

### 8.2 已验证行为

- 新增、暂存、未暂存、已提交、删除、重命名、中文和空格文件名均进入审计。
- 已提交的越界文件会阻止合并，并保留 Worktree 供人工检查。
- merge 使用任务创建时保存的基线分支；原仓库不干净时拒绝自动合并。
- merge 成功后删除 Worktree 和任务分支并清除 TaskStore 关联；discard 同样完成清理。
- Worktree 指向错误仓库、错误 runtime 根目录、错误任务路径或错误分支时会拒绝操作。

### 8.3 发布结论

- **P3 代码与自动化验收通过。**
- `use_worktree` 继续默认 `false` 仅用于受控启用，不再代表 P3 审核失败。
- 已登记的 P2 Runner/PTY 警告继续作为技术债处理，不阻塞 P3 或第一版落地。
- 下一开发模块为 P4；若与 Codex 并行开发，应使用独立 Git Worktree 和分支，最后再集成共享入口文件。
