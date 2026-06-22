# MiMo Bridge MCP

一个让 Codex 通过 MCP 调度 MiMo Code 执行编码任务的本地桥接服务。

核心模式很简单：**Codex 负责规划和审核，MiMo Code 负责低成本执行，通过 MCP 和 Git Worktree 实现可控协作。**

## 这个项目是什么

MiMo Bridge MCP 是一个 Windows-first 的本地 MCP 桥接项目。它让 Codex / 主控 Agent 可以把有边界的编码任务交给 MiMo Code 执行，而不是让 Codex 自己在对话里输出大量代码。

任务会在独立的 Git Worktree 中运行。MiMo Code 完成修改后，Codex 先读取 review 摘要、变更文件、风险提示和必要的 focused diff，再决定接受还是丢弃结果。

## 解决什么问题

在真实开发中，Codex 很适合做这些事：

- 拆任务。
- 设定约束。
- 判断架构影响。
- 审核 diff。
- 决定是否合并。

但如果让 Codex 长时间直接写代码，会消耗大量输出 token，也容易让上下文变得臃肿。MiMo Bridge MCP 的目标是把“决策”和“执行”分开：Codex 留在审核和控制位置，MiMo Code 在明确边界内完成具体修改。

## 为什么能节省 token

传统方式里，主模型可能要反复输出代码、解释代码、读取大段文件和完整 diff。这个项目推荐的流程是：

1. Codex 发起一个边界清楚的任务。
2. MiMo Code 在独立 Worktree 中执行。
3. Codex 只先读取 `detail_level="review"` 的摘要。
4. 如果发现风险，再读取指定 diff、指定文件或日志尾部。
5. Codex / 用户决定 merge 或 discard。

也就是说，Codex 不需要为了方便而读取整个仓库、完整日志或完整 diff。

## 适合谁

- 想尝试 Codex + 执行型 Agent 协作的人。
- 希望降低长代码生成循环 token 成本的人。
- 需要每个任务隔离在 Git Worktree 中执行的开发者。
- 想测试本地 MCP、Windows launcher、portable ZIP / EXE installer 工作流的人。
- 愿意帮助早期开源项目做 Windows 验证、文档和示例的人。

## 当前限制

- 当前优先支持 Windows 10/11 x64。
- MiMo Code 需要用户单独安装并登录。
- 项目仍处于 early alpha，可能存在不稳定行为。
- clean Windows 10/11 验证仍需要更多社区测试。
- 不建议把本地 daemon 暴露到公网。

## 快速启动

### 前置条件

- Windows 10/11 x64。
- 已安装并登录 MiMo Code。
- 已安装 Git。
- 可使用支持 MCP 的 Codex 或其他主控 Agent。
- 源码开发需要 Node.js；使用打包版本时可使用 bundled Node。

### 启动本地 daemon

在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/start-local.ps1
```

### Launcher 控制命令

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 status
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 start -Open
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 stop
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 restart -Open
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 logs
```

### MCP endpoint

把 Codex 的 MCP 配置指向：

```text
http://127.0.0.1:3210/mcp
```

### Admin UI

本地管理界面地址：

```text
http://127.0.0.1:3210/
```

## Codex 使用流程

推荐低 token 流程：

1. Codex 使用 `mimo_start_task` 或同类工具启动任务。
2. Codex 使用 `mimo_wait_task` 等待一次，并设置合理 timeout。
3. Codex 使用 `mimo_get_task(detail_level="review")` 读取审核摘要。
4. 如果有风险，再读取 focused diff、指定文件或指定日志。
5. Codex 审核后决定合并或丢弃 Worktree。
6. MiMo Code 不应该自行合并自己的任务结果。

## 常见问题

### daemon 启动不了怎么办？

先确认 Node.js、Git 和 MiMo Code 是否可用，再用 launcher 查看状态和日志：

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 status
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 logs
```

### 端口 3210 被占用怎么办？

先确认是不是已有 MiMo Bridge daemon 正在运行。如果是旧进程，先停止再重启：

```powershell
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 stop
powershell -ExecutionPolicy Bypass -File apps/local-daemon/launcher.ps1 start -Open
```

### Codex 看不到 MCP 工具怎么办？

确认 MCP endpoint 是 `http://127.0.0.1:3210/mcp`，并重启 Codex 或打开新的 Codex 会话。配置变更通常不会自动热更新到已有会话里。

### MiMo 任务卡住怎么办？

不要反复轮询完整结果。先用 bounded wait，超时后读取最小状态或日志尾部。如果任务已经不可恢复，再按项目当前规则取消或丢弃 Worktree。

更多排障内容见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)。

## 如何参与贡献

欢迎从这些方向开始：

- 在 clean Windows 10/11 x64 上测试 portable ZIP 和 EXE installer。
- 补充 Codex MCP 配置示例。
- 改进端口冲突、MiMo 登录、任务超时等排障文档。
- 添加 Admin UI 截图和 demo GIF。
- 改进 release validation 报告可读性。
- 补充最小 demo 项目。

开始贡献前请阅读：

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [docs/GOOD_FIRST_ISSUES.md](docs/GOOD_FIRST_ISSUES.md)

请不要在 Issue 或 PR 中提交 API Key、token、完整私有日志、MiMo 凭据、个人路径或其他隐私信息。
