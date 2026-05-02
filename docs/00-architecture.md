# Agent Framework 架构设计

> 基于 TypeScript/Bun 的多渠道 AI Agent 共享会话框架

---

## 1. 设计目标

```
┌──────────────────────────────────────────────────────────────┐
│                         设计目标                               │
├──────────────────────────────────────────────────────────────┤
│  1. 多渠道接入: 飞书 (Sidecar)、Web UI、SSH、Webhook、      │
│     GitHub、MCP                                              │
│  2. 共享 Session: 多渠道共享同一会话上下文                    │
│  3. Agent 无关: 纯声明式配置，无自定义执行类                   │
│  4. 通用 Runtime: CLI (一次性进程) / tmux (持久会话) /        │
│     Container (Docker/Podman 隔离)                           │
│  5. Pipeline 编排: 多轮 Tool Calling + 流式 StreamChunk      │
│  6. 会话工作目录: 每 session 独立配置 + 热切换                 │
│  7. 部署简单: Bun 单 binary + Go Sidecar                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. 核心架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              用户层 (多渠道)                               │
│                                                                          │
│  飞书 Bot    Web UI      SSH     Webhook    GitHub    MCP Client         │
│   (Sidecar)   (SSE+WS)           (POST)     (Webhook) (SSE Transport)   │
└──────┬──────────┬──────────┬──────────┬──────────┬──────────┘
       │          │          │          │          │
       └──────────┼──────────┼──────────┼──────────┘
                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          渠道层 (Channels)                                │
│                                                                          │
│  ChannelManager                                                          │
│  ├── registerFactory(factory) — 开放 string 类型，无封闭联合              │
│  ├── enable(type, config)    — create → connect                          │
│  ├── get<T>(type) → Channel                                              │
│  └── broadcast(sessionId, message) — 按 capability 分发                   │
│                                                                          │
│  Channel Interface: connect / disconnect / send / handleEvent            │
│  Channel type: 'feishu' | 'websocket' | 'ssh' | 'webhook' | 'github' | 'mcp'
└──────────────────────────┬───────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          核心层 (Core)                                    │
│                                                                          │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                │
│  │ Session      │   │   Router     │   │  EventBus    │                │
│  │ Manager      │   │              │   │  (Pub/Sub)   │                │
│  │              │   │ route(msg) → │   │              │                │
│  │ MemoryStore  │   │  session     │   │ agent.think  │                │
│  │ RedisStore   │   │  + pipeline  │   │ agent.resp   │                │
│  │ SQLite 持久化 │   │  executeStr()│   │ agent.error  │                │
│  └──────────────┘   └──────┬───────┘   └──────────────┘                │
│                            │                                            │
│  ┌──────────────┐   ┌──────┴───────┐   ┌──────────────┐                │
│  │ SessionBind  │   │ PipelineEng  │   │ ToolRegistry │                │
│  │ Store        │   │ + ToolLoop   │   │ shell/git/   │                │
│  │ (ch,uid)→sid │   │              │   │ file         │                │
│  └──────────────┘   └──────┬───────┘   └──────────────┘                │
└────────────────────────────┼────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        Agent 层 — Runtime 层                             │
│                                                                          │
│  AgentManager (name → Agent 声明式配置)                                   │
│    ├── hermes  (cli)      hermes chat -q {message} -Q                    │
│    ├── claude  (cli)      claude -p {message}                            │
│    ├── aider   (session)  tmux: send-keys + capture-pane                 │
│    └── echo    (cli)      echo Echo: {message} (测试)                     │
│                        + optional container: { image: '...' }            │
│                                                                          │
│  RuntimeRegistry                                                         │
│    ├── CLIRuntime        bun.spawn → stdout → StreamChunk               │
│    ├── SessionRuntime    tmux send-keys + capture-pane → StreamChunk    │
│    └── ContainerRuntime  docker/podman run --rm -i → stdout → StreamChunk│
│                                                                          │
│  工作目录传递链:                                                          │
│  session.context.workingDir → Router → PipelineEngine → runtime.start()  │
│    ├── CLIRuntime:       bun.spawn({ cwd: workingDir })                  │
│    ├── SessionRuntime:   tmux cd <workingDir> && ...                     │
│    └── ContainerRuntime: docker -v <hostDir>:<containerDir> -w <...>     │
└──────────────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          工具层 (Tools)                                  │
│                    Shell ◄──► Git ◄──► File                             │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 目录结构

```
agent-framework/
├── src/
│   ├── core/                   # 核心模块
│   │   ├── session.ts         # SessionManager + SessionBindingStore
│   │   ├── session-binding.ts # (channel, userId) → sessionId 映射
│   │   ├── router.ts          # 消息路由 → PipelineEngine
│   │   ├── event.ts           # 事件总线 (Pub/Sub + subscribeSession)
│   │   ├── types.ts           # Session / UnifiedMessage / Tool 类型
│   │   ├── config.ts          # SQLite ConfigManager + XOR 加密
│   │   ├── registry.ts        # ToolRegistry
│   │   ├── channel-manager.ts # ChannelManager (工厂 + 生命周期 + 广播)
│   │   └── sidecar-rpc.ts     # JSON-RPC 2.0 over stdio
│   │
│   ├── channels/              # 渠道层 (开放 string 类型)
│   │   ├── types.ts           # Channel / ChannelFactory / ChannelDependencies
│   │   ├── feishu/           # 飞书 Sidecar 实现
│   │   │   ├── sidecar-channel.ts  # 精简版 Channel
│   │   │   ├── card-builder.ts     # 8 种卡片构建器
│   │   │   ├── menu-state.ts       # 菜单状态机
│   │   │   ├── factory.ts
│   │   │   └── sidecar-loader.ts   # 二进制查找
│   │   ├── websocket/         # Web UI (SSE + WS)
│   │   │   ├── channel.ts
│   │   │   └── factory.ts
│   │   ├── ssh/               # SSH 终端
│   │   │   ├── channel.ts
│   │   │   └── factory.ts
│   │   ├── webhook/           # 外部 Webhook API
│   │   │   ├── channel.ts     # 同步/异步双模式
│   │   │   └── factory.ts
│   │   ├── github/            # GitHub App Webhook
│   │   │   ├── auth.ts        # Token + App JWT 双认证
│   │   │   ├── channel.ts     # issue_comment → agent → 回复
│   │   │   └── factory.ts
│   │   └── mcp/               # MCP Server
│   │       ├── channel.ts     # McpServer + HonoSSETransport
│   │       └── factory.ts
│   │
│   ├── agents/               # Agent 声明式 + Pipeline
│   │   ├── manager.ts        # AgentManager
│   │   ├── types.ts          # Agent / ContainerConfig / RuntimeType
│   │   ├── runtime/
│   │   │   ├── types.ts      # RuntimeAdapter { start(sessionId, agent, workingDir?) }
│   │   │   ├── registry.ts   # RuntimeRegistry
│   │   │   ├── cli.ts        # CLIRuntime (bun spawn)
│   │   │   ├── session.ts    # SessionRuntime (tmux)
│   │   │   └── container.ts  # ContainerRuntime (docker/podman)
│   │   └── pipeline/
│   │       ├── executor.ts   # PipelineEngine (自动检测容器配置)
│   │       └── tool-loop.ts  # ToolLoop (多轮 tool calling)
│   │
│   ├── tools/                # 工具集
│   │   ├── base.ts / shell.ts / git.ts / file.ts
│   │
│   ├── web/                  # Web 服务
│   │   ├── server.ts         # Hono + Bun.serve + SSE
│   │   └── ui/index.html     # 单页 Web UI
│   │
│   └── index.ts              # 入口: 组装所有组件
│
├── sidecars/                 # Go Sidecar
│   └── feishu/
│       ├── main.go           # 入口
│       ├── rpc.go            # 双向 RPC
│       └── feishu.go         # 飞书 WS
│
├── test/
│   └── integration/
│       ├── sidecar-channel.test.ts
│       ├── sidecar-rpc.test.ts
│       └── channels-e2e.test.ts   # Webhook + GitHub + MCP E2E
│
├── docs/
│   └── 00-architecture.md
│
├── package.json / tsconfig.json / Dockerfile / docker-compose.yml
└── README.md
```

---

## 4. 核心组件

### 4.1 SessionManager + SessionBindingStore

```typescript
// src/core/session.ts
interface Session {
  id: string;
  userId: string;
  agentType: string;
  messages: UnifiedMessage[];
  context: SessionContext;     // { workingDir?, env? }
  state: SessionState;         // active | paused | closed
  pinned?: boolean;            // 永久保存 (无 TTL)
  participants?: Participant[]; // [{ channel, userId }] 跨渠道追踪
}

class SessionManager {
  create(userId, agentType, context?, sessionId?, channel?): Promise<Session>;
  get(sessionId): Promise<Session | null>;
  updateContext(sessionId, updates): Promise<Session>;
  pin / unpin / close / switchAgent / addParticipant / ...
}

class SessionBindingStore {
  get(channel, userId): Promise<string | null>;
  set(channel, userId, sessionId): Promise<void>;
  getOrCreate(channel, userId, createFn): Promise<string>;
}
```

### 4.2 EventBus

```typescript
class EventBus {
  publish(event);                           // 通知 type + session 监听器
  subscribe(type, handler);                 // 按事件类型订阅
  subscribeSession(sessionId, handler);     // 按 session 订阅
  broadcastToChannel(session, content);     // 发布 agent.response
}

type EventType =
  | 'session.created' | 'session.updated' | 'session.closed'
  | 'agent.thinking' | 'agent.stream_chunk'
  | 'agent.tool_executing' | 'agent.response' | 'agent.error';
```

### 4.3 RuntimeAdapter

```typescript
interface RuntimeAdapter {
  readonly type: 'cli' | 'session' | 'container';

  start(sessionId: string, agent: Agent, workingDir?: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
  isRunning(sessionId: string): boolean;
  send(sessionId: string, message: string): Promise<void>;
  read(sessionId: string): AsyncGenerator<StreamChunk>;
  cancel(sessionId: string): Promise<void>;
  cleanup(sessionId: string): Promise<void>;
}
```

三种实现：

| 实现 | 机制 | 工作目录 |
|------|------|---------|
| **CLIRuntime** | `bun.spawn()` 每次新进程 | `cwd: workingDir` |
| **SessionRuntime** | `tmux new-session` + `send-keys` | `cd <workingDir> && ...` |
| **ContainerRuntime** | `docker run --rm -i` | `-v <hostDir>:<workDir> -w <workDir>` |

### 4.4 PipelineEngine

```typescript
class PipelineEngine {
  async *executeStream(agentName, sessionId, message, signal?, workingDir?) {
    // 1. resolveRuntime(agent)
    //    → 如果有 agent.config.container → ContainerRuntime
    //    → 否则 agent.runtimeType → CLIRuntime / SessionRuntime
    // 2. runtime.start(sessionId, agent, workingDir)
    // 3. runtime.send(sessionId, message)
    // 4. ToolLoop.run() → 多轮 tool calling
    // 5. runtime.cleanup(sessionId)
  }
}
```

---

## 5. 渠道接入

### 5.1 Channel 接口

```typescript
interface ChannelCapabilities {
  text: boolean;
  cards: boolean;
  images: boolean;
  files: boolean;
  richText: boolean;
  cardActions: boolean;
}

interface Channel {
  readonly type: string;      // 开放 string
  readonly name: string;
  readonly capabilities: ChannelCapabilities;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  handleEvent(event: unknown): Promise<void>;
  send(sessionId: string, message: OutgoingMessage): Promise<void>;
}
```

### 5.2 各渠道详情

| 渠道 | 入站 | 出站 |
|------|------|------|
| **飞书** | Sidecar JSON-RPC: `on('message')` → `router.route()` | `sendCard()` / `sendText()` via RPC |
| **Web UI** | `POST /api/chat/:sessionId` 或 WS message | SSE stream (`agent.thinking/stream_chunk/response`) |
| **SSH** | `handleEvent({ sessionId, content })` | `tmux send-keys` |
| **Webhook** | `POST /api/channels/webhook/:token` | 同步 HTTP Response 或异步 fire-and-forget |
| **GitHub** | `POST /api/channels/github/webhook` (HMAC 验证) | `POST /repos/:owner/:repo/issues/:num/comments` |
| **MCP** | `POST /api/channels/mcp/message` (JSON-RPC) | SSE stream via `HonoSSETransport` |

### 5.3 添加新渠道

```typescript
// 1. 创建 src/channels/<name>/channel.ts
// 2. 创建 src/channels/<name>/factory.ts
// 3. 在 server.ts 加路由 (如果需要 HTTP 端点)
// 4. 在 index.ts 注册:
channelManager.registerFactory(new MyChannelFactory());
```

---

## 6. 容器运行时

ContainerRuntime 使用可配置的容器引擎运行 agent，适用于任意 agent：

```
<引擎> run --rm -i \
  -v <host工作目录>:<容器工作目录> \
  -w <容器工作目录> \
  [--memory <limit>] [--cpus <limit>] [--network none] \
  <镜像> <agent命令> <参数>
```

- 引擎命令通过 config `container_cmd` 配置 (默认 `docker`)
- Agent 声明式加 `config.container` 字段 → PipelineEngine 自动选择 ContainerRuntime
- 工作目录自动挂载为 volume

---

## 7. 工作目录

链路:

```
ConfigManager.get('working_dir') → '/projects/sandbox' (fallback)
        ↓
创建 Session 时存入 context.workingDir
        ↓
用户可通过 API 修改 (Web UI 双击编辑 / Feishu 卡片 / /workdir 命令)
        ↓
Router.route() 读取 → 传入 PipelineEngine.executeStream()
        ↓
RuntimeAdapter.start(sessionId, agent, workingDir) 使用
```

---

## 8. MCP Server

自定义 `HonoSSETransport` 适配 Bun/Hono：

```
Client → GET /api/channels/mcp/sse
        ← event: endpoint, data: /api/channels/mcp/message?sessionId=<id>
Client → POST /api/channels/mcp/message?sessionId=<id>
        ← SSE data: { jsonrpc: "2.0", result: { content: [...] } }
```

暴露工具: `chat`, `list_agents`, `create_session`, `get_session_info`

---

## 9. 配置项

| key | 类别 | 加密 | 说明 |
|-----|------|------|------|
| `openai_api_key` | ai | 是 | OpenAI API Key |
| `anthropic_api_key` | ai | 是 | Anthropic API Key |
| `default_agent` | agent | 否 | 默认 agent |
| `working_dir` | agent | 否 | 默认工作目录 |
| `container_cmd` | agent | 否 | 容器引擎 (docker/podman/nerdctl) |
| `feishu_app_id` | channel | 否 | 飞书 App ID |
| `feishu_app_secret` | channel | 是 | 飞书 App Secret |
| `github_token` | channel | 是 | GitHub PAT |
| `github_app_id` | channel | 否 | GitHub App ID |
| `github_private_key` | channel | 是 | GitHub App 私钥 |
| `github_webhook_secret` | channel | 是 | Webhook HMAC 密钥 |
| `webhook_tokens` | system | 否 | Webhook 允许 token |
| `port` / `host` | system | 否 | 服务器 |
| `redis_url` | system | 否 | Redis 连接 |
| `session_secret` | system | 是 | 加密密钥 |

---

## 10. 测试

```
75 tests, 0 fail, 131 expect() calls across 14 files:

test/integration/
├── sidecar-channel.test.ts  — 飞书卡片操作测试 (4 tests)
├── sidecar-rpc.test.ts       — JSON-RPC 协议测试
└── channels-e2e.test.ts     — Webhook + GitHub + MCP E2E (11 tests)
```

---

## 11. API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/` | Web UI |
| POST | `/api/sessions` | 创建会话 |
| GET | `/api/sessions` | 会话列表 |
| GET/POST | `/api/sessions/:id/working-dir` | 工作目录 |
| POST | `/api/chat/:sessionId` | 发送消息 |
| GET | `/api/chat/:sessionId/sse` | SSE 流 |
| POST | `/api/chat/:sessionId/cancel` | 取消 |
| POST | `/api/channels/webhook/:token` | Webhook |
| POST | `/api/channels/github/webhook` | GitHub Webhook |
| GET | `/api/channels/mcp/sse` | MCP SSE |
| POST | `/api/channels/mcp/message` | MCP 消息 |

---

## 12. 部署

```bash
bun run build                          # 构建 dist/index.js
# 上传到服务器
bun run dist/index.js                  # 运行
# 或 Docker
docker compose up -d
```

健康检查: `curl http://host:3000/health`
