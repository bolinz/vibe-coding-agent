# Agent Framework 架构设计

> 基于 TypeScript/Bun 的多渠道 AI Agent 共享会话框架

---

## 1. 设计目标

```
┌─────────────────────────────────────────────────────────────────┐
│                         设计目标                                  │
├─────────────────────────────────────────────────────────────────┤
│  1. 多渠道接入: 飞书 (Sidecar)、WebSocket、SSH                 │
│  2. 共享 Session: 多渠道共享同一会话上下文                       │
│  3. Agent 无关: 纯声明式配置，无自定义执行类                    │
│  4. 通用 Runtime: CLI (一次性进程) / tmux (持久会话)           │
│  5. Pipeline 编排: 多轮 Tool Calling + 流式 StreamChunk        │
│  6. 部署简单: Bun 单 binary + Go Sidecar                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户层 (多渠道)                                │
│                                                                         │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐               │
│   │   飞书      │   │   Web      │   │   SSH      │               │
│   │   Bot       │   │   UI       │   │   终端     │               │
│   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘               │
└──────────┼────────────────┼────────────────┼──────────────────────────────┘
           │                │                │
           ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          渠道层 (Channels)                               │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │                   BaseChannel (abstract)                      │    │
│   │   ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌───────────┐ │    │
│   │   │ Sidecar    │ │ WebSocket  │ │  SSH     │ │ Feishu   │ │    │
│   │   │ Feishu     │ │ Channel    │ │  Channel │ │ (depr.)  │ │    │
│   │   │ (Go stdio) │ │ (Bun WS)   │ │ (tmux)   │ │(SDK WS)  │ │    │
│   │   └────────────┘ └────────────┘ └──────────┘ └───────────┘ │    │
│   │                                                             │    │
│   │   Channel Interface: connect / disconnect / send /          │    │
│   │   handleMessage → UnifiedMessage {channel, sessionId, ...} │    │
│   └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          核心层 (Core)                                   │
│                                                                         │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│   │   Session        │  │    Router        │  │    EventBus      │   │
│   │   Manager        │  │                  │  │    (Pub/Sub)     │   │
│   │                  │  │  route(msg) →    │  │                  │   │
│   │  MemoryStore     │  │    session       │  │  agent.thinking  │   │
│   │  RedisStore      │  │    + pipeline    │  │  agent.response  │   │
│   │  SQLite 持久化   │  │  executeStream() │  │  agent.error     │   │
│   └──────────────────┘  └──────────────────┘  └──────────────────┘   │
│                                                                         │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│   │   ConfigManager  │  │   SidecarRPC     │  │   ToolRegistry   │   │
│   │                  │  │                  │  │                  │   │
│   │  SQLite 存储     │  │  JSON-RPC 2.0    │  │  shell / git     │   │
│   │  env 覆盖        │  │  stdin/stdout    │  │  / file          │   │
│   │  XOR 加密        │  │  method 注册     │  │                  │   │
│   └──────────────────┘  └──────────────────┘  └──────────────────┘   │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Agent 层 — Pipeline 编排                          │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │                   AgentManager (config registry)               │    │
│   │   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ │    │
│   │   │ claude   │ │ hermes   │ │ aider    │ │ echo (test)    │ │    │
│   │   │ CLI cfg  │ │ CLI cfg  │ │ session  │ │ CLI cfg        │ │    │
│   │   └──────────┘ └──────────┘ └──────────┘ └────────────────┘ │    │
│   └──────────────────────────────────────────────────────────────┘    │
│                              |                                         │
│                              ▼                                         │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │              PipelineEngine + ToolLoop                        │    │
│   │                                                             │    │
│   │   StreamChunk{text | tool_call | tool_result | error | done} │    │
│   │                                                             │    │
│   │   executeStream(name, sessionId, message) → AsyncGenerator   │    │
│   │     → 1. getRuntime(name) → CLIRuntime / SessionRuntime      │    │
│   │     → 2. spawn process (bun spawn / tmux send-keys)         │    │
│   │     → 3. read stdout → StreamChunk.text                     │    │
│   │     → 4. ToolLoop: detect tool calls → execute → repeat     │    │
│   └──────────────────────────────────────────────────────────────┘    │
│                              |                                         │
│                              ▼                                         │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │               RuntimeRegistry                                │    │
│   │                                                             │    │
│   │   CLIRuntime (一次性进程)                                    │    │
│   │     ├ bun spawn → stdout + stderr → stream                  │    │
│   │     ├ 支持 {message} 占位符注入                              │    │
│   │     └ cancel via process.kill                                │    │
│   │                                                             │    │
│   │   SessionRuntime (tmux 持久会话)                             │    │
│   │     ├ tmux new-session / send-keys / capture-pane            │    │
│   │     ├ 防注入: send-keys 转义                                 │    │
│   │     └ cleanup: 超时/手动关闭                                 │    │
│   └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          工具层 (Tools)                                 │
│                                                                         │
│   ┌───────────┐  ┌───────────┐  ┌───────────┐                       │
│   │   Shell   │  │    Git    │  │   File    │                       │
│   │   Tool    │  │   Tool    │  │   Tool    │                       │
│   └───────────┘  └───────────┘  └───────────┘                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 目录结构

```
agent-framework/
├── src/
│   ├── core/                   # 核心模块
│   │   ├── session.ts         # 会话管理 (Memory/Redis)
│   │   ├── router.ts          # 消息路由 → PipelineEngine
│   │   ├── registry.ts        # ToolRegistry 仅 (AgentRegistry 已删除)
│   │   ├── event.ts           # 事件总线 (Pub/Sub)
│   │   ├── types.ts           # Channel/UnifiedMessage/Session 类型
│   │   ├── config.ts          # SQLite ConfigManager + XOR 加密
│   │   └── sidecar-rpc.ts     # JSON-RPC 2.0 over stdio
│   │
│   ├── channels/              # 渠道接入
│   │   ├── base.ts           # BaseChannel 抽象类
│   │   ├── sidecar-feishu.ts # Go Sidecar 飞书 (生产在用)
│   │   ├── feishu.ts         # 直连模式飞书 (已休眠，等待删除)
│   │   ├── feishu-register.ts# 扫码注册飞书 Bot (独立工具)
│   │   ├── websocket.ts      # Bun WebSocket
│   │   └── ssh.ts            # Tmux SSH
│   │
│   ├── agents/               # Agent 层 (声明式 + Pipeline)
│   │   ├── manager.ts        # AgentManager — 注册/查询/删除
│   │   ├── types.ts          # Agent 配置描述 + StreamChunk
│   │   ├── runtime/
│   │   │   ├── types.ts      # RuntimeAdapter 接口
│   │   │   ├── registry.ts   # RuntimeRegistry
│   │   │   ├── cli.ts        # CLIRuntime (bun spawn)
│   │   │   └── session.ts    # SessionRuntime (tmux)
│   │   └── pipeline/
│   │       ├── executor.ts   # PipelineEngine — 编排执行
│   │       └── tool-loop.ts  # ToolLoop — 多轮 tool calling
│   │
│   ├── tools/                # 工具集
│   │   ├── base.ts           # Tool 基类
│   │   ├── shell.ts          # Shell 执行
│   │   ├── git.ts            # Git 操作
│   │   └── file.ts           # 文件操作
│   │
│   ├── web/                  # Web 服务
│   │   └── server.ts         # Hono + Bun.serve + SSE
│   │
│   └── index.ts              # 入口: 组装所有组件
│
├── sidecars/                 # Go Sidecar
│   └── feishu/
│       ├── main.go           # 入口: stdio JSON-RPC
│       ├── rpc.go            # 双向 RPC 实现
│       ├── feishu.go         # 飞书 WS + 卡片刷新
│       ├── logger.go         # SDK 日志重定向
│       └── Makefile          # 跨平台编译
│
├── test/
│   ├── integration/
│   │   ├── sidecar-channel.test.ts
│   │   └── sidecar-rpc.test.ts
│   └── e2e/
│       └── sidecar-card-refresh.ts
│
├── .env                      # 环境变量
├── .gitignore
├── .local/deploy.md          # 部署笔记 (gitignored)
├── bunfig.toml
├── tsconfig.json
├── package.json
└── README.md
```

---

## 4. 核心组件

### 4.1 Session Manager

```typescript
// src/core/session.ts

interface Session {
  id: string;
  userId: string;
  agentType: string;         // string — 支持任意外部 CLI
  messages: UnifiedMessage[];
  context: SessionContext;
  state: SessionState;       // active | paused | closed
  createdAt: Date;
  updatedAt: Date;
}

class SessionManager {
  private store: SessionStore;   // MemorySessionStore | RedisSessionStore

  async create(userId: string, agentType?: string, ...): Promise<Session>;
  async get(sessionId: string): Promise<Session | null>;
  async getByUserId(userId: string): Promise<Session | null>;
  async addMessage(sessionId: string, message: UnifiedMessage): Promise<void>;
  async switchAgent(sessionId: string, agentType: string): Promise<void>;
  async close(sessionId: string): Promise<void>;
}
```

### 4.2 Event Bus

```typescript
// src/core/event.ts

type EventType =
  | 'session.created'
  | 'session.updated'
  | 'session.closed'
  | 'agent.thinking'
  | 'agent.response'
  | 'agent.error';

interface SessionEvent {
  type: EventType;
  sessionId: string;
  data: unknown;
  timestamp: Date;
}

class EventBus {
  publish(event: SessionEvent): void;
  subscribe(type: EventType, handler: EventHandler): () => void;
  subscribeSession(sessionId: string, handler: EventHandler): () => void;
  broadcastToChannel(session: Session, content: string): Promise<void>;
}
```

### 4.3 AgentManager (取代 AgentRegistry)

```typescript
// src/agents/manager.ts

interface AgentConfig {
  name: string;
  description: string;
  runtimeType: 'cli' | 'session';
  config: CLIConfig | SessionConfig;
  capabilities: { streaming: boolean; multiTurn: boolean };
}

class AgentManager {
  register(config: AgentConfig): void;
  get(name: string): AgentConfig | null;
  list(): AgentConfig[];
  remove(name: string): void;
}
```

### 4.4 Router → PipelineEngine

```typescript
// src/core/router.ts

class Router {
  async route(message: UnifiedMessage): Promise<void> {
    // 1. Get or create session
    const session = await this.getOrCreateSession(message);

    // 2. Add message to session
    await this.sessionManager.addMessage(session.id, message);

    // 3. Execute via PipelineEngine (streaming + tool loops)
    for await (const chunk of this.pipeline.executeStream(
      session.agentType, session.id, message.content
    )) {
      if (chunk.type === 'text') responseChunks.push(chunk.content);
      else if (chunk.type === 'error') responseError = chunk.content;
      else if (chunk.type === 'done') break;
    }

    // 4. Add response to session
    await this.sessionManager.addMessage(session.id, assistantMessage);

    // 5. Broadcast response to all channels
    await this.eventBus.broadcastToChannel(session, responseContent);
  }
}
```

### 4.5 PipelineEngine + ToolLoop

```typescript
// src/agents/pipeline/executor.ts

type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; tool: string; args: unknown }
  | { type: 'tool_result'; tool: string; result: unknown }
  | { type: 'error'; content: string }
  | { type: 'done' };

class PipelineEngine {
  async *executeStream(
    agentName: string,
    sessionId: string,
    message: string
  ): AsyncGenerator<StreamChunk> {
    // 1. Runtime selection → CLIRuntime / SessionRuntime
    // 2. Process execution → stdout streaming
    // 3. StreamChunk.text emission
    // 4. ToolLoop: detect tool calls → ToolRegistry.execute → repeat
    // 5. ToolLoop terminates when agent emits final response
  }
}
```

### 4.6 SidecarRPC

```typescript
// src/core/sidecar-rpc.ts

class SidecarRPC extends EventEmitter {
  // JSON-RPC 2.0 over Go sidecar stdin/stdout
  // Supports:
  //   Call(method, params) → Promise<result>    (request-response)
  //   Notify(method, params)                    (fire-and-forget)
  //   RegisterMethod(name, handler)             (handle sidecar → node calls)
  //   on('message', handler)                    (sidecar → node notifications)

  async start(): Promise<void>;                // spawn Go process
  stop(): void;                                 // kill
  async call<T>(method: string, params?: unknown): Promise<T>;
}
```

---

## 5. 渠道接入

### 5.1 Channel 接口

```typescript
// src/core/types.ts & src/channels/base.ts

interface Channel {
  readonly type: ChannelType;     // 'feishu' | 'websocket' | 'ssh'
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  handleMessage(event: unknown): Promise<void>;
  send(sessionId: string, message: string): Promise<void>;
}

abstract class BaseChannel implements Channel {
  protected router: Router;
  protected createUnifiedMessage(...): UnifiedMessage;
}
```

### 5.2 飞书渠道 (Sidecar 模式 — 生产)

```
用户@飞书 → Feishu WS → Go Sidecar → stdin JSON-RPC → Node.js
                                                          ↓
                                                   handleCardAction()
                                                   (同步返回 < 3s, 飞书要求)
                                                          ↓
                                                   后台 setTimeout:
                                                   doNewSession / doSetAgent
```

- 卡片按钮点击: Sidecar 同步返回 `CardActionTriggerResponse` (卡片更新 + toast)
- 文本消息: Sidecar → Node.js `handleSidecarMessage()` → Router → Pipeline
- 发送: `rpc.call('sendMessage', ...)` 或 `rpc.call('sendCardSync', ...)`

### 5.3 WebSocket 渠道

```
用户浏览器 → Bun.serve WebSocket upgrade → WebSocketChannel
  ├── handleWSMessage() → UnifiedMessage → Router.route()
  └── send() → JSON 推送至所有同 sessionId 的 WS 连接
```

- SSE 渠道通过 `/api/chat/:sessionId/sse` + EventBus 订阅实现

### 5.4 SSH 渠道

```
用户 SSH → 附加 tmux session → SSHChannel
  ├── handleMessage() → UnifiedMessage → Router.route()
  └── send() → tmux send-keys 写入
```

---

## 6. 部署架构

```
用户@飞书                   用户@浏览器               用户@SSH
    │                           │                       │
    │ Feishu WS                 │ HTTP/WS                │ tmux
    ▼                           ▼                       ▼
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  Go Sidecar  │         │              │         │              │
│ feishu-sidecar│        │  Bun Server  │         │  tmux 会话   │
│ (stdio RPC)  │◄──RPC──►│  (port 3000) │         │              │
└──────────────┘         │              │         └──────┬───────┘
                         │  Hono + WS   │                │
                         │  + SSE       │◄───────────────┘
                         └──────┬───────┘
                                │
                                ▼
                         ┌──────────────┐
                         │   SQLite     │
                         │  (配置存储)   │
                         └──────┬───────┘
                                │
                         ┌──────────────┐
                         │    Redis     │
                         │ (可选会话持久) │
                         └──────────────┘
```

---

## 7. 技术栈

| 组件 | 技术选型 | 理由 |
|------|----------|------|
| **运行时** | Bun | 性能最佳、内置 TS 支持、单 binary |
| **Web 框架** | Hono | 轻量、快速、类型安全 |
| **LLM 运行时** | llama.cpp (Hermes) | 本地推理，不依赖外部 API |
| **Agent CLI** | hermes / claude / codex / aider | 外部 CLI，通过 RuntimeAdapter 适配 |
| **飞书接入** | Go Sidecar + JSON-RPC | 同步卡片刷新 (< 3s)，分离 SDK 日志 |
| **会话存储** | Memory / Redis | 开发用 Memory，生产可切换 Redis |
| **配置存储** | SQLite (better-sqlite3) | 零配置，持久化，XOR 加密 |
| **类型检查** | TypeScript (tsc --noEmit) | 编译期检查、AI 生成友好 |

---

## 8. 工作流程

```
用户@飞书 ──► Sidecar ──► handleSidecarMessage()
                                     │
                                     ▼
                              Router.route()
                                     │
                          ┌──────────┼──────────┐
                          │                     │
                          ▼                     ▼
                   SessionManager          EventBus.publish
                   getOrCreate session     ('agent.thinking')
                          │
                          ▼
                   PipelineEngine.executeStream()
                          │
                    ┌─────┴─────┐
                    │           │
                    ▼           ▼
              RuntimeAdapter  ToolLoop
              spawn CLI       detect tool calls
              read stdout     execute tools
              emit chunks     feed back to agent
                    │           │
                    └─────┬─────┘
                          │
                          ▼
                   response + streamChunks
                          │
                          ▼
                   SessionManager          EventBus.publish
                   addMessage              ('agent.response')
                          │
                          ▼
                   broadcastToChannel()
                    ┌──────┼──────┐
                    │      │      │
                    ▼      ▼      ▼
                 飞书   WebSocket  SSH
                 回复     推送     输出
```

---

## 9. Agent 注册 (声明式)

Agent 现在是纯配置，无自定义类：

```typescript
// src/index.ts

const agentManager = new AgentManager();

// CLI 模式: 一次性进程
agentManager.register({
  name: 'hermes',
  description: 'Hermes CLI (AI assistant)',
  runtimeType: 'cli',
  config: { command: 'hermes', args: ['chat', '-q', '{message}', '-Q'] },
  capabilities: { streaming: true, multiTurn: true }
});

// session 模式: tmux 持久会话
agentManager.register({
  name: 'aider',
  description: 'Aider coding assistant',
  runtimeType: 'session',
  config: {
    command: 'aider',
    env: { OPENAI_API_KEY: '...', OPENAI_API_BASE: '...' }
  },
  capabilities: { streaming: true, multiTurn: true }
});

// 新增 CLI 工具只需加一条 register() 调用
```

---

## 10. 配置管理

```typescript
// src/core/config.ts

class ConfigManager {
  // 双来源: SQLite DB + .env 覆盖
  // XOR 加密: 敏感字段 (feishu_app_secret) 使用 SESSION_SECRET 加密存储
  // 热加载: reloadEnvFromDb() 将 SQLite 配置写入 process.env

  get(key: string): string | null;
  set(key: string, value: string): void;
  getAllEntries(): Record<string, string>;
  reloadEnvFromDb(): void;
  reset(): void;
}
```

**重要：** `SESSION_SECRET` 必须跨环境一致。SQLite 中的加密数据依赖此密钥，不一致会导致解密失败。

---

## 11. 飞书 Sidecar 架构

### 11.1 为什么需要 Sidecar

飞书卡片按钮点击需要 **3 秒内返回** `CardActionTriggerResponse`。Node.js 事件循环 + Python 等无法保证。Go sidecar 在子进程中同步处理飞书 WS，通过 stdio 与 Node.js 通信。

### 11.2 通信协议

```
┌─────────────────┐          stdin/out          ┌─────────────────┐
│                 │  ◄────── JSON-RPC 2.0 ──────►│                 │
│   Node.js      │                              │    Go Sidecar   │
│                 │  request (node→go):          │                 │
│  SidecarRPC     │    {method, params, id}      │  sendMessage    │
│                 │  ───────────────────────────►│  sendCardSync   │
│                 │                              │  disconnect     │
│  registerMethod │  response (go→node):         │                 │
│  ("cardAction") │    {result, error, id}        │                 │
│                 │  ◄───────────────────────────│                 │
│                 │                              │                 │
│                 │  notification (go→node):      │                 │
│                 │    {method:"message", params} │                 │
│                 │  ◄───────────────────────────│                 │
└─────────────────┘                              └─────────────────┘
```

### 11.3 卡片刷新流程

```
用户点击卡片按钮
        │
        ▼
Go Sidecar 收到 card.action.trigger 事件
        │
        ▼
Sidecar 将 action 转发到 Node.js (RPC call)
        │
        ▼
Node.js handleCardAction():
  ├── 构建更新后的卡片 (card builders)
  ├── 异步操作通过 setTimeout 后台执行 (session 创建/切换)
  └── 同步返回 { card, toast } 给 Sidecar
        │
        ▼
Sidecar 返回 CardActionTriggerResponse → 飞书
  ├── 卡片原地刷新 (< 3ms ✅)
  └── Toast 提示
```

---

## 12. 飞书 Bot 配置

### 12.1 飞书开放平台配置

1. 创建企业自建应用, 获取 `App ID` + `App Secret`
2. 开启机器人能力
3. 添加权限:
   - `im:message` — 发送消息
   - `im:message.receive_v1` — 接收消息
4. 事件订阅 → 添加事件 `im.message.receive_v1`
5. 机器人能力 → 开启「接收消息」

### 12.2 凭据注入

```bash
# 方式一: 直接写入 SQLite (推荐)
cd /path/to/app && source ~/.bash_profile
cat > script.ts << 'EOF'
import { ConfigManager } from './src/core/config';
const cm = new ConfigManager();
cm.set('feishu_app_id', 'cli_xxxxxxxxxxxx');
cm.set('feishu_app_secret', 'your-secret');
EOF
bun run script.ts && rm script.ts

# 方式二: .env (覆盖 SQLite)
echo "FEISHU_APP_ID=cli_xxx" >> .env
echo "FEISHU_APP_SECRET=your-secret" >> .env
```

### 12.3 消息处理流程 (Sidecar 版)

```typescript
// 文本消息
private async handleSidecarMessage(params: any): Promise<void> {
  const unifiedMessage = this.createUnifiedMessage(
    params.userId, params.userId, params.content, params.userId
  );
  await this.router.route(unifiedMessage);
}

// 卡片按钮 (需 3 秒内返回)
async handleCardAction(params: any): Promise<{ card; toast }> {
  switch (params.action) {
    case 'new_session':
      setTimeout(() => this.doNewSession(params.userId), 0);
      return { card: this.buildMenuCard(...), toast: '新会话' };
    case 'set_agent':
      setTimeout(() => this.doSetAgent(params.userId, value.agent), 0);
      return { card: this.buildMenuCard(...), toast: `已切换` };
    // ...
  }
}
```

---

## 13. 部署检查清单

- [ ] `bun run build` 成功 (生成 `dist/index.js`)
- [ ] Go sidecar 已编译: `cd sidecars/feishu && GOOS=linux GOARCH=amd64 make build`
- [ ] `sidecars/feishu/feishu-sidecar` → 符号链接指向 Linux 二进制
- [ ] 远程 `.env` 的 `SESSION_SECRET` 与本地一致
- [ ] Feishu 凭据已写入 SQLite (或 `.env`)
- [ ] Redis 可选: `REDIS_URL` 环境变量
- [ ] 运行: `bun run dist/index.js`
- [ ] 健康检查: `curl -s http://host:3000/health`
- [ ] 飞书发送消息验证

---

## 14. 参考

- [飞书开放平台](https://open.feishu.cn/document/)
- [Bun 文档](https://bun.sh/docs)
- [Hono 文档](https://hono.dev/)
- JSON-RPC 2.0: https://www.jsonrpc.org/specification
