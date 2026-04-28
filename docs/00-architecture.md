# Agent Framework 架构设计

> 基于 TypeScript/Bun 的多渠道AI Agent共享会话框架

---

## 1. 设计目标

```
┌─────────────────────────────────────────────────────────────────┐
│                         设计目标                                  │
├─────────────────────────────────────────────────────────────────┤
│  1. 多渠道接入: 飞书、WebSocket、SSH                           │
│  2. 共享Session: 多渠道共享同一会话上下文                       │
│  3. Agent无关: 可插拔的Agent适配器                            │
│  4. 安全隔离: AI操作在沙箱中执行                               │
│  5. 部署简单: Bun单binary                                     │
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
           └────────────────┼────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          渠道层 (Channels)                               │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │                   Channel Interface                            │    │
│   │                                                             │    │
│   │   receive(event) → UnifiedMessage → Session                   │    │
│   │   send(message) ← Response ← Session                         │    │
│   └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          核心层 (Core)                                   │
│                                                                         │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│   │   Session       │  │    Router        │  │    Registry     │     │
│   │   Manager      │  │                  │  │                 │     │
│   │                │  │  message →      │  │  - Agent       │     │
│   │  - create     │  │    session      │  │  - Tool        │     │
│   │  - get       │  │                  │  │  - Channel     │     │
│   │  - update    │  │  response →     │  │                 │     │
│   │  - persist   │  │    channel      │  │  discover()    │     │
│   └─────────────────┘  └─────────────────┘  └─────────────────┘     │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │                   Event Bus (Pub/Sub)                        │     │
│   │                                                             │     │
│   │   session.updated ──► [notify] ──► watchers                  │     │
│   │   agent.thinking  ──► [stream] ──► channels                │     │
│   └──────────────────────────────────────────────────────────────┘     │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Agent层 (Adapters)                             │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │                   BaseAgent (Interface)                     │     │
│   │                                                             │     │
│   │   execute(session, message): Promise<string>               │     │
│   │   cancel(): void                                          │     │
│   │   getStatus(): AgentStatus                                │     │
│   └──────────────────────────────────────────────────────────────┘     │
│                              ▲                                        │
│          ┌─────────────────┼─────────────────┐                      │
│          │                 │                 │                       │
│   ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐              │
│   │   Aider     │  │   Claude   │  │   Custom    │              │
│   │   Adapter  │  │   Adapter  │  │   Adapter   │              │
│   └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          工具层 (Tools)                                 │
│                                                                         │
│   ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐       │
│   │   Shell   │  │    Git    │  │   File    │  │   Search  │       │
│   │   Tool    │  │   Tool    │  │   Tool    │  │   Tool    │       │
│   └───────────┘  └───────────┘  └───────────┘  └───────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 目录结构

```
agent-framework/
├── src/
│   ├── core/                    # 核心模块
│   │   ├── session.ts          # 会话管理
│   │   ├── router.ts          # 消息路由
│   │   ├── registry.ts         # Agent/Tool注册表
│   │   ├── event.ts           # 事件总线
│   │   └── types.ts           # 类型定义
│   │
│   ├── channels/               # 渠道接入
│   │   ├── base.ts            # Channel基类
│   │   ├── feishu.ts         # 飞书接入
│   │   ├── websocket.ts       # WebSocket接入
│   │   └── ssh.ts             # SSH接入
│   │
│   ├── agents/                 # Agent适配器
│   │   ├── base.ts           # Agent基类
│   │   ├── aider.ts          # Aider适配器
│   │   ├── claude.ts         # Claude适配器
│   │   └── types.ts          # Agent类型
│   │
│   ├── tools/                  # 工具集
│   │   ├── base.ts           # Tool基类
│   │   ├── shell.ts          # Shell执行
│   │   ├── git.ts            # Git操作
│   │   └── file.ts           # 文件操作
│   │
│   ├── web/                   # Web服务
│   │   ├── server.ts         # Hono服务器
│   │   ├── routes/           # 路由
│   │   └── middleware/       # 中间件
│   │
│   └── index.ts               # 入口
│
├── test/                       # 测试
├── bunfig.toml                 # Bun配置
├── tsconfig.json              # TypeScript配置
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
  agentType: AgentType;
  messages: Message[];
  context: SessionContext;
  state: SessionState;
  createdAt: Date;
  updatedAt: Date;
}

type SessionState = 'active' | 'paused' | 'closed';
type AgentType = 'aider' | 'claude' | 'custom';

class SessionManager {
  private sessions: Map<string, Session>;
  private store: SessionStore;

  async create(userId: string, agentType?: AgentType): Promise<Session>;
  async get(sessionId: string): Promise<Session | null>;
  async update(session: Session): Promise<void>;
  async addMessage(sessionId: string, message: Message): Promise<void>;
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
  private listeners: Map<EventType, Set<EventHandler>>;

  publish(event: SessionEvent): void;
  subscribe(type: EventType, handler: EventHandler): () => void;
  broadcast(sessionId: string): void;  // 通知所有渠道
}
```

### 4.3 Registry

```typescript
// src/core/registry.ts

class AgentRegistry {
  private agents: Map<string, AgentAdapter>;
  private agents: Map<string, Tool>;

  register(name: string, adapter: AgentAdapter): void;
  get(name: string): AgentAdapter | null;
  list(): string[];
  discover(): Promise<AgentAdapter[]>;
}

class ToolRegistry {
  private tools: Map<string, Tool>;

  register(name: string, tool: Tool): void;
  get(name: string): Tool | null;
  execute(name: string, args: unknown): Promise<unknown>;
}
```

### 4.4 Router

```typescript
// src/core/router.ts

interface UnifiedMessage {
  channel: ChannelType;
  channelId: string;
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

class Router {
  async route(message: UnifiedMessage): Promise<void> {
    // 1. 获取或创建Session
    const session = await this.sessionManager.getOrCreate(message.sessionId);

    // 2. 添加消息到Session
    await this.sessionManager.addMessage(session.id, message);

    // 3. 获取Agent执行
    const agent = this.registry.getAgent(session.agentType);

    // 4. 执行并获取响应
    const response = await agent.execute(session, message.content);

    // 5. 广播响应给所有渠道
    await this.eventBus.broadcast(session.id, response);
  }
}
```

---

## 5. Agent适配器

### 5.1 接口定义

```typescript
// src/agents/base.ts

interface AgentAdapter {
  readonly name: string;
  readonly description: string;

  execute(session: Session, message: string): Promise<AgentResponse>;
  cancel(sessionId: string): Promise<void>;
  getStatus(sessionId: string): AgentStatus;
}

interface AgentResponse {
  content: string;
  tools?: ToolCall[];
  done: boolean;
}

type AgentStatus = 'idle' | 'running' | 'error';
```

### 5.2 Aider适配器

```typescript
// src/agents/aider.ts

class AiderAdapter implements AgentAdapter {
  readonly name = 'aider';
  readonly description = 'Terminal AI coding assistant';

  async execute(session: Session, message: string): Promise<AgentResponse> {
    // 1. 写入命令到Aider输入
    await this.writeToAider(session.id, message);

    // 2. 等待响应
    const output = await this.readFromAider(session.id, { timeout: 120000 });

    return {
      content: output,
      done: true
    };
  }

  // 通过tmux socket与Aider通信
  private async writeToAider(sessionId: string, message: string): Promise<void>;
  private async readFromAider(sessionId: string, opts: { timeout: number }): Promise<string>;
}
```

### 5.3 Claude适配器

```typescript
// src/agents/claude.ts

class ClaudeAdapter implements AgentAdapter {
  readonly name = 'claude';
  readonly description = 'Anthropic Claude Code';

  async execute(session: Session, message: string): Promise<AgentResponse> {
    // 调用Claude Code CLI
    const result = await Bun.spawn([
      'claude',
      '-p', message,
      '--cwd', session.context.workingDir
    ]);

    const output = await new Response(result.stdout).text();

    return {
      content: output,
      done: true
    };
  }
}
```

---

## 6. 渠道接入

### 6.1 Channel基类

```typescript
// src/channels/base.ts

interface Channel {
  readonly type: ChannelType;
  readonly name: string;

  // 接收消息
  handleMessage(event: ChannelEvent): Promise<void>;

  // 发送消息
  send(sessionId: string, message: string): Promise<void>;

  // 生命周期
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

type ChannelType = 'feishu' | 'websocket' | 'ssh';
```

### 6.2 飞书渠道

```typescript
// src/channels/feishu.ts

class FeishuChannel implements Channel {
  readonly type = 'feishu';
  readonly name = 'Feishu Bot';

  async handleMessage(event: FeishuEvent): Promise<void> {
    const unifiedMessage: UnifiedMessage = {
      channel: 'feishu',
      channelId: event.openId,
      sessionId: event.openId,  // 用openId作为sessionId
      userId: event.openId,
      role: 'user',
      content: event.text,
      timestamp: new Date()
    };

    await this.router.route(unifiedMessage);
  }

  async send(sessionId: string, message: string): Promise<void> {
    await this.feishuClient.sendMessage(sessionId, message);
  }
}
```

### 6.3 WebSocket渠道

```typescript
// src/channels/websocket.ts

class WebSocketChannel implements Channel {
  readonly type = 'websocket';
  readonly connections: Map<string, WebSocket>;

  async handleMessage(ws: WebSocket, event: WebSocketEvent): Promise<void> {
    const { sessionId, message } = JSON.parse(event.data);

    await this.router.route({
      channel: 'websocket',
      channelId: ws.id,
      sessionId,
      userId: sessionId,
      role: 'user',
      content: message,
      timestamp: new Date()
    });
  }

  async send(sessionId: string, message: string): Promise<void> {
    const ws = this.connections.get(sessionId);
    if (ws) {
      ws.send(JSON.stringify({ type: 'response', content: message }));
    }
  }
}
```

---

## 7. 安全隔离

```
┌─────────────────────────────────────────────────────────────────┐
│                       安全边界                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   AI执行环境                                                     │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  Docker容器                                              │  │
│   │  ├── --read-only (根文件系统只读)                      │  │
│   │  ├── --network none (无网络)                          │  │
│   │  ├── --memory=1g (内存限制)                           │  │
│   │  ├── --pids-limit=50 (进程数限制)                     │  │
│   │  └── --cap-drop ALL (移除所有权限)                     │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                  │
│   项目目录隔离                                                   │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  /projects/                                             │  │
│   │  ├── --bind--mount--ro (只读挂载)                       │  │
│   │  └── sandbox/ (AI可写)                                  │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. 部署架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           部署架构                                      │
└─────────────────────────────────────────────────────────────────────────┘

  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
  │   飞书      │         │   用户      │         │   SSH       │
  │   服务器    │         │   浏览器    │         │   客户端    │
  └──────┬──────┘         └──────┬──────┘         └──────┬──────┘
         │ Webhook                   │ WebSocket                 │ SSH
         │                           │                           │
         └───────────────────────────┼───────────────────────────┘
                                     │
                              ┌──────▼──────┐
                              │             │
                              │    nginx    │
                              │  (反向代理)  │
                              │             │
                              └──────┬──────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
            ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
            │             │  │             │  │             │
            │   Bun       │  │  feishu-    │  │  ws-server  │
            │   Server    │  │  bot        │  │             │
            │  (主服务)   │  │  (独立)     │  │             │
            │             │  │             │  │             │
            └──────┬──────┘  └─────────────┘  └─────────────┘
                   │
                   ▼
            ┌─────────────┐
            │             │
            │   Redis     │
            │  (会话存储)  │
            │             │
            └─────────────┘
```

---

## 9. 技术栈

| 组件 | 技术选型 | 理由 |
|------|----------|------|
| **运行时** | Bun | 性能最佳、内置TS支持、单binary |
| **框架** | Hono | 轻量、快速、类型安全 |
| **会话存储** | Redis | 成熟、支持持久化、支持订阅 |
| **WebSocket** | 内置 | Bun原生支持 |
| **Agent调用** | child_process | Bun内置，调用CLI方便 |
| **类型检查** | TypeScript | 编译期检查、AI生成友好 |

---

## 10. 工作流程

```
用户@飞书 ──► 消息 ──► Router ──► Session ──► Agent
                              │                      │
                              │                      ▼
                              │                 [执行命令]
                              │                      │
                              │                      ▼
                              │                 [返回响应]
                              │                      │
                              ▼                      │
                         EventBus ───────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌─────────┐   ┌─────────┐   ┌─────────┐
        │  飞书   │   │ WebSocket│   │  SSH   │
        │ 回复     │   │ 推送    │   │ 输出    │
        └─────────┘   └─────────┘   └─────────┘
```

---

## 11. Aider 集成

### 11.1 Aider 工作模式

Aider 是核心 AI 交互组件,支持两种运行模式:

```bash
# 交互模式 - 通过 tmux 会话运行
tmux new -s ai
aider

# 命令模式 - 直接调用
aider --no-git --read-only \
  --model openai/gpt-4o \
  --message "解释这段代码"
```

### 11.2 Aider 常用命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `/add` | 添加文件到对话 | `/add main.py` |
| `/drop` | 从对话移除文件 | `/drop utils.py` |
| `/commit` | 提交 Git 更改 | `/commit` |
| `/diff` | 查看更改 | `/diff` |
| `/ask` | 快速提问 | `/ask 如何优化查询?` |
| `/run` | 执行 Shell 命令 | `/run pytest` |
| `/undo` | 撤销上次操作 | `/undo` |

### 11.3 Aider 配置

```yaml
# ~/.config/aider/aider.conf.yml
openai-api-key: ${OPENAI_API_KEY}
openai-api-base: ${OPENAI_API_BASE}

editor: vim
auto-commits: true
commit-quietly: true

# 危险命令限制
dangerously-use-aiderc: false

# 上下文
map-tokens: 1024
max-chat-history: 10
```

### 11.4 tmux 集成

```typescript
// 通过 tmux socket 与 Aider 通信
class AiderAdapter {
  private async writeToAider(sessionId: string, message: string): Promise<void> {
    // 写入 tmux 会话
    await Bun.spawn(['tmux', 'send-keys', '-t', sessionId, message, 'Enter']);
  }

  private async readFromAider(sessionId: string): Promise<string> {
    // 捕获 tmux 会话输出
    const result = await Bun.spawn([
      'tmux', 'capture-pane', '-t', sessionId, '-p'
    ]);
    return new Response(result.stdout).text();
  }
}
```

---

## 12. 飞书 Bot 配置

### 12.1 飞书开放平台配置

1. 创建企业自建应用,获取 `App ID` + `App Secret`
2. 开启机器人能力
3. 添加权限:
   - `im:message` - 发送消息
   - `im:message.receive_v1` - 接收消息
4. 配置事件订阅: `im.message.receive_v1`
5. 设置 Webhook 地址: `https://你的域名/feishu/webhook`

### 12.2 消息处理流程

```typescript
// src/channels/feishu.ts
async handleMessage(event: FeishuEvent): Promise<void> {
  // 1. URL 验证 (飞书配置时)
  if (event.challenge) {
    return { challenge: event.challenge };
  }

  // 2. 提取消息内容
  const content = JSON.parse(event.message.content);
  const text = content.text?.trim();

  // 3. 获取发送者
  const senderId = event.sender.sender_id.open_id;

  // 4. 路由到统一消息
  const unifiedMessage: UnifiedMessage = {
    channel: 'feishu',
    channelId: senderId,
    sessionId: senderId,
    userId: senderId,
    role: 'user',
    content: text,
    timestamp: new Date()
  };

  await this.router.route(unifiedMessage);
}
```

### 12.3 消息类型

```typescript
// 发送文本消息
const textPayload = {
  receive_id: openId,
  msg_type: 'text',
  content: JSON.stringify({ text: 'Hello!' })
};

// 发送富文本消息
const postPayload = {
  receive_id: openId,
  msg_type: 'post',
  content: JSON.stringify({
    zh_cn: {
      title: 'AI回复',
      content: [[
        { tag: 'text', text: '代码:\n' },
        { tag: 'code', text: 'print("hello")' }
      ]]
    }
  })
};
```

---

## 13. nginx 反向代理

### 13.1 路由配置

```nginx
server {
    listen 80;
    server_name _;

    # 飞书 Bot Webhook
    location /feishu/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket 支持
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # 主应用
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
```

### 13.2 安全响应头

```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
```

---

## 14. 安全隔离

### 14.1 分层安全架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        网络层 (Layer 1)                          │
│  ufw防火墙  │  fail2ban  │  Tailscale ACLs                      │
├─────────────────────────────────────────────────────────────────┤
│                        应用层 (Layer 2)                          │
│  Docker容器隔离  │  AppArmor  │  seccomp                        │
├─────────────────────────────────────────────────────────────────┤
│                        会话层 (Layer 3)                          │
│  tmux独立用户  │  审计日志  │  命令历史                         │
├─────────────────────────────────────────────────────────────────┤
│                      文件系统层 (Layer 4)                        │
│  只读系统  │  chattr保护  │  绑定挂载                         │
├─────────────────────────────────────────────────────────────────┤
│                      命令限制层 (Layer 5)                        │
│  命令白名单  │  PATH限制  │  alias限制                          │
└─────────────────────────────────────────────────────────────────┘
```

### 14.2 Docker 安全配置

```bash
docker run -d \
  --name aider-sandbox \
  --user agent \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=100m \
  --memory="1g" \
  --memory-swap="1g" \
  --cpus="1.0" \
  --pids-limit="50" \
  --network none \
  --cap-drop ALL \
  --security-opt=no-new-privileges:true \
  -v /projects/sandbox:/workspace:rw \
  alpine tail -f /dev/null
```

### 14.3 文件系统防护

```bash
# chattr 保护
chattr +i /projects           # 不可删除/修改
lsattr /projects             # 查看属性

# 绑定挂载为只读
mount --bind -o ro /projects /projects
```

### 14.4 用户权限限制

```bash
# /etc/sudoers.d/aiuser
aiuser ALL=(ALL) NOPASSWD: /usr/bin/tmux
aiuser ALL=(ALL) NOPASSWD: /usr/bin/docker
aiuser ALL=(ALL) NOPASSWD: /usr/bin/git
aiuser ALL=(ALL) NO          # 禁止其他 sudo
```

### 14.5 审计配置

```bash
# 监控项目目录
auditctl -w /projects -p wa -k ai_projects

# 危险命令监控
auditctl -a always,exit -F arch=b64 -S rm -S rmdir -k ai_delete
auditctl -a always,exit -F arch=b64 -S chmod -S chown -k ai_chmod
```

---

## 15. 部署检查清单

- [ ] Docker no-new-privileges 已启用
- [ ] 容器网络已禁用 (`--network none`)
- [ ] 容器文件系统只读 (`--read-only`)
- [ ] Linux 能力已移除 (`--cap-drop ALL`)
- [ ] 内存限制已设置 (`--memory`)
- [ ] 进程数限制已设置 (`--pids-limit`)
- [ ] `/projects` 目录已 `chattr +i`
- [ ] auditd 规则已配置
- [ ] 防火墙已启用
- [ ] SSH 密码登录已禁用
- [ ] aiuser sudo 权限已限制
- [ ] fail2ban 已配置

---

## 16. 参考

- [Aider 官方文档](https://aider.chat/docs)
- [飞书开放平台](https://open.feishu.cn/document/)
- [nginx 官方文档](https://nginx.org/en/docs/)
- [Docker 安全文档](https://docs.docker.com/engine/security/)
- [code-server 文档](https://coder.com/docs/code-server)
