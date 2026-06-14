# mimo-bridge-mcp-server

MCP 传话员：连接 Codex 与 MiMo Code 的桥梁

## 简介

本项目是一个 MCP (Model Context Protocol) 服务器，负责在 Codex 和 MiMo Code 之间传递任务和结果。

## 功能

- `mimo_start_task`: 创建并后台启动 MiMo 任务
- `mimo_get_task`: 查询任务状态、回复和日志摘要
- `mimo_reply_task`: 继续已有 MiMo 会话

## 安装

```bash
npm install
npm run build
```

## 配置

在 Codex 配置文件中添加：

```toml
[mcp_servers.mimo_bridge]
command = 'C:\Program Files\nodejs\node.exe'
args = ['<本项目路径>/dist/index.js']
startup_timeout_sec = 10
tool_timeout_sec = 30
enabled = true

[mcp_servers.mimo_bridge.env]
MIMO_NODE_PATH = '<MiMo Node.js 路径>'
MIMO_ENTRY_PATH = '<MiMo CLI 入口路径>'
MIMO_ALLOWED_ROOTS = '<允许的工作区根目录>'
MIMO_RUNTIME_DIR = '<运行时目录路径>'
```

## 测试

```bash
npm test
```

## 中文排错说明

### 启动失败

**问题**: `MIMO_NODE_PATH 环境变量未设置`

**解决**: 在 Codex 配置文件中设置 `MIMO_NODE_PATH` 环境变量，指向 MiMo 自带的 Node.js 可执行文件。

---

**问题**: `MIMO_ENTRY_PATH 指向的文件不存在`

**解决**: 检查 `MIMO_ENTRY_PATH` 路径是否正确。MiMo CLI 入口通常位于：
```
D:\AI\Mimo2 Codex\.tools\node-v22.22.3-win-x64\node_modules\@mimo-ai\cli\bin\mimo
```

---

**问题**: `无法获取 MiMo Node.js 版本`

**解决**: 确保 `MIMO_NODE_PATH` 指向的 Node.js 可执行文件存在且可运行。

### 任务创建失败

**问题**: `已有任务在运行中，第一版只支持同时运行一个写任务`

**解决**: 等待当前任务完成或取消后再创建新任务。

---

**问题**: `路径不在允许的根目录范围内`

**解决**: 确保 `workspace_path` 在 `MIMO_ALLOWED_ROOTS` 设置的目录范围内。

---

**问题**: `session_id 格式无效`

**解决**: 会话 ID 必须符合格式 `ses_` 后跟字母、数字或下划线。

### 任务执行失败

**问题**: `MiMo 未返回 sessionID，任务失败`

**解决**: 检查 MiMo 是否正常运行，查看 `runtime/logs/` 目录下的日志文件。

---

**问题**: `任务超时`

**解决**: 增加 `runtime_timeout_seconds` 参数值，或检查 MiMo 是否卡住。

### 测试失败

**问题**: 测试提示 `缺少 --file 参数`

**解决**: 确保测试脚本正确传递了所有必需参数。

---

**问题**: 测试提示 `任务说明文件缺少 '# 任务说明' 标记`

**解决**: 任务说明文件必须包含 `# 任务说明` 标题。

## 作者

MiMo Code (Xiaomi MiMo)
