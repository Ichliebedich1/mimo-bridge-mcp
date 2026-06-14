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

## 作者

MiMo Code (Xiaomi MiMo)
