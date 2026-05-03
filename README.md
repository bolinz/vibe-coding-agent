# Vibe Coding Agent

> 基于 TypeScript/Bun 的多渠道 AI Agent 共享会话框架。支持飞书、Web UI、SSH、Webhook、GitHub、MCP 等渠道，会话跨渠道共享。

---

## 设计目标

```
┌──────────────────────────────────────────────────────────────┐
│                         设计目标                               │
├──────────────────────────────────────────────────────────────┤
│  1. 多渠道接入: 飞书 / WebUI / SSH / Webhook / GitHub / MCP  │
│  2. 共享 Session: 多渠道共享同一会话上下文                     │
│  3. 任意 Agent: 纯声明式配置 CLI / tmux / 容器运行           │
│  4. 会话工作目录: 每会话可独立配置，支持热切换                  │
│  5. 容器运行时: Docker/Podman 隔离执行任意 Agent              │
│  6. Pipeline 编排: 多轮 Tool Calling + 流式 StreamChunk      │
│  7. 部署简单: Bun 单 binary + Go Sidecar                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 技术栈

| 组件 | 技术选型 | 理由 |
|------|----------|------|
| **运行时** | Bun 1.3+ | 性能最佳、内置 TS 支持、单 binary |
| **语言** | TypeScript | AI 生成友好、类型安全 |
| **前端框架** | Preact + TSX | 3KB, React API, Bun 编译 |
| **图标库** | lucide-preact | 线条 SVG 图标, tree-shakeable |
| **Web 框架** | Hono | 轻量、快速、类型安全 |
| **会话存储** | Memory / Redis | 开发用 Memory，生产可切换 Redis |
| **配置存储** | SQLite (bun:sqlite) | 零配置，持久化，XOR 加密 |
| **Agent 运行** | `RuntimeAdapter` | CLI / tmux / Docker 统一接口 |
| **飞书接入** | Go Sidecar + JSON-RPC | 同步卡片刷新 (< 3s) |
| **容器引擎** | Docker / Podman / nerdctl | 可配置，按 agent 声明 |

---

## 渠道一览

| 渠道 | 类型 | 能力 | 接入方式 |
|------|------|------|---------|
| **飞书 Bot** | `feishu` | 文本 + 卡片 + 富文本 | Go Sidecar (stdio RPC) |
| **Web UI** | `websocket` | 文本 (SSE + WS) | HTTP/WS, 内置管理界面 |
| **SSH** | `ssh` | 文本 | tmux 会话 |
| **Webhook** | `webhook` | 文本 (同步/异步) | `POST /api/channels/webhook/:token` |
| **GitHub** | `github` | 文本 | `POST /api/channels/github/webhook` (HMAC 验证) |
| **MCP** | `mcp` | 文本 (MCP Tools) | `GET /api/channels/mcp/sse` (SSE Transport) |

### 快速接入

添加新渠道只需要 2 个文件 + 1 行注册：

```typescript
// 1. 实现 Channel 接口
class MyNewChannel implements Channel { ... }
// 2. 实现 ChannelFactory
class MyNewChannelFactory implements ChannelFactory { ... }
// 3. 在 index.ts 注册
channelManager.registerFactory(new MyNewChannelFactory());
```

`Channel.type` 是开放 `string`，无需修改 `types.ts`、`router.ts`、`event.ts` 等核心文件。

---

## 架构概览

```
用户层
  飞书 Bot    Web UI      SSH      Webhook    GitHub    MCP Client
     │          │          │          │          │          │
     └──────────┼──────────┼──────────┼──────────┼──────────┘
                ▼
          ChannelManager
     ┌──────────────────────┐
     │  Router (消息路由)    │
     │  + SessionBinding    │  ← (channel, userId) → sessionId
     │  + EventBus (Pub/Sub) │  ← agent.thinking / response / error
     └──────────┬───────────┘
                ▼
     ┌──────────────────────┐
     │  PipelineEngine       │
     │  + ToolLoop           │  ← 多轮 tool calling
     └──────────┬───────────┘
                ▼
     ┌──────────────────────┐
     │  RuntimeAdapter       │
     │  CLI / Session /      │
     │  Container            │
     └──────────┬───────────┘
                ▼
     Agent: hermes / claude / aider / opencode / echo ...
```

---

## 目录结构

```
src/
├── core/                    # 核心模块
│   ├── session.ts          # SessionManager (Memory/Redis)
│   ├── session-binding.ts  # (channel, userId) → sessionId 映射
│   ├── router.ts           # 消息路由 → PipelineEngine
│   ├── event.ts            # 事件总线 (Pub/Sub + broadcastToChannel)
│   ├── types.ts            # Session / UnifiedMessage / Tool 类型
│   ├── config.ts           # SQLite ConfigManager + XOR 加密
│   ├── registry.ts         # ToolRegistry
│   ├── channel-manager.ts  # Channel 生命周期 + 能力感知广播
│   └── sidecar-rpc.ts      # JSON-RPC 2.0 over stdio
│
├── channels/               # 渠道接入 (开放 string 类型)
│   ├── types.ts            # Channel / ChannelFactory / ChannelDependencies
│   ├── feishu/             # 飞书 Sidecar 实现
│   ├── websocket/          # Web UI + SSE
│   ├── ssh/                # SSH 终端
│   ├── webhook/            # 外部 API webhook
│   ├── github/             # GitHub App Webhook (Token + App JWT)
│   └── mcp/                # MCP Server (Model Context Protocol)
│
├── agents/                 # Agent 声明式配置 + Pipeline 执行
│   ├── manager.ts          # AgentManager (name → Agent)
│   ├── types.ts            # Agent / ContainerConfig / StreamChunk
│   ├── runtime/
│   │   ├── cli.ts          # CLIRuntime — bun spawn 一次进程
│   │   ├── session.ts      # SessionRuntime — tmux 持久会话
│   │   └── container.ts    # ContainerRuntime — Docker/Podman
│   └── pipeline/
│       ├── executor.ts     # PipelineEngine — 自动选择运行时
│       └── tool-loop.ts    # ToolLoop — 多轮 tool calling
│
├── tools/                  # 工具集 (shell / git / file)
│
├── web/
│   ├── server.ts           # Hono + SSE + WS + API 路由
│   └── ui/                 # Preact + TSX 前端 (Bun 编译)
│       ├── index.html      # Chat 页面入口壳
│       ├── config.html     # 配置页面入口壳
│       ├── styles/         # CSS 变量主题系统
│       │   ├── variables.css
│       │   ├── base.css
│       │   ├── chat.css
│       │   └── config.css
│       ├── shared/         # 共享层
│       │   ├── api.ts      # 类型化 fetch
│       │   ├── types.ts    # 前端类型
│       │   └── utils.ts    # 工具函数
│       └── pages/
│           ├── chat/       # Chat SPA (8 个组件)
│           └── config/     # Config SPA (7 个组件)
│
└── index.ts                # 入口: 组装所有组件
```

---

## 快速开始

```bash
# 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 安装依赖
bun install

# 开发模式
bun run dev

# 类型检查 + 测试 + 构建
bun run typecheck
bun test
bun run build
bun run start
```

---

## Agent 配置（声明式）

Agent 是纯配置，无自定义类。支持三种运行时：

```typescript
// CLI 模式: 一次性进程
agentManager.register({
  name: 'hermes',
  runtimeType: 'cli',
  config: { command: 'hermes', args: ['chat', '-q', '{message}', '-Q'] },
  capabilities: { streaming: true, multiTurn: true }
});

// tmux 模式: 持久会话 (aider)
agentManager.register({
  name: 'aider',
  runtimeType: 'session',
  config: {
    command: 'aider',
    env: { OPENAI_API_KEY: '...' }
  },
  capabilities: { streaming: true, multiTurn: true }
});

// 容器模式: Docker/Podman 隔离执行
agentManager.register({
  name: 'opencode-container',
  runtimeType: 'cli',                // 声明为 cli，自动检测 container config
  config: {
    command: 'opencode',
    args: ['run', '{message}'],
    container: {                      // 有此字段 → 自动走 ContainerRuntime
      image: 'node:20-slim',
      workDir: '/workspace',
      memory: '1g',
    }
  },
  capabilities: { streaming: true, multiTurn: true }
});
```

任意 agent 加 `config.container` 字段即可容器化，无需新增 agent 条目。

---

## 配置项

| key | 类别 | 说明 |
|-----|------|------|
| `default_agent` | agent | 默认 agent |
| `working_dir` | agent | 默认工作目录 |
| `container_cmd` | agent | 容器引擎 (docker/podman/nerdctl) |
| `openai_api_key` | ai | OpenAI API Key |
| `anthropic_api_key` | ai | Anthropic API Key |
| `feishu_app_id` | channel | 飞书 App ID |
| `feishu_app_secret` | channel | 飞书 App Secret |
| `github_token` | channel | GitHub Personal Access Token |
| `github_app_id` | channel | GitHub App ID |
| `github_private_key` | channel | GitHub App 私钥 (PEM) |
| `github_webhook_secret` | channel | GitHub Webhook HMAC 密钥 |
| `webhook_tokens` | system | Webhook token 列表 |
| `port` / `host` / `redis_url` | system | 服务器配置 |

---

## API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | Chat Web UI (Preact SPA) |
| GET | `/config` | 配置管理页面 (独立 SPA) |
| GET | `/ui/*` | 静态资源 (编译后的 JS/CSS) |
| GET | `/health` | 健康检查 |
| GET/POST | `/api/sessions` | 会话管理 |
| POST | `/api/chat/:sessionId` | 发送消息 |
| GET | `/api/chat/:sessionId/sse` | SSE 流 |
| POST | `/api/chat/:sessionId/cancel` | 取消 |
| POST | `/api/channels/webhook/:token` | Webhook |
| POST | `/api/channels/github/webhook` | GitHub Webhook |
| GET/POST | `/api/channels/mcp/sse` + `/message` | MCP Server |

## 构建与开发

```bash
bun run typecheck     # tsc --noEmit
bun test              # 75 tests
bun run build:ui      # 仅编译前端 (Chat + Config)
bun run build         # 编译全部 (后端 + 前端)
bun run start         # 生产运行
```

---

## 文档

| 文档 | 内容 |
|------|------|
| `docs/00-architecture.md` | 完整架构设计 |
| `docs/01-ui-design.md` | UI 设计文档 (现代极简风格) |
| `docs/08-deployment-status.md` | 部署指南 |
