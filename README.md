# Agent Framework

> 基于 TypeScript/Bun 的多渠道AI Agent共享会话框架

---

## 项目目标

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

## 技术栈

| 组件 | 技术选型 | 理由 |
|------|----------|------|
| **运行时** | Bun 1.3+ | 性能最佳、内置TS支持、单binary |
| **语言** | TypeScript | AI生成友好、类型安全 |
| **Web框架** | Hono | 轻量、快速、类型安全 |
| **会话存储** | Redis | 成熟、支持订阅 |
| **Agent调用** | child_process | Bun内置 |

---

## 目录结构

```
vibe-coding-agent/
├── src/
│   ├── core/            # 核心模块
│   │   ├── session.ts  # 会话管理
│   │   ├── router.ts   # 消息路由
│   │   ├── registry.ts # Agent/Tool注册表
│   │   ├── event.ts    # 事件总线
│   │   └── types.ts    # 类型定义
│   │
│   ├── channels/        # 渠道接入
│   │   ├── base.ts     # Channel基类
│   │   ├── feishu.ts   # 飞书接入
│   │   ├── websocket.ts# WebSocket接入
│   │   └── ssh.ts      # SSH接入
│   │
│   ├── agents/         # Agent适配器
│   │   ├── base.ts    # Agent基类
│   │   ├── aider.ts   # Aider适配器
│   │   └── claude.ts  # Claude适配器
│   │
│   ├── tools/          # 工具集
│   │   ├── base.ts    # Tool基类
│   │   ├── shell.ts   # Shell执行
│   │   ├── git.ts     # Git操作
│   │   └── file.ts    # 文件操作
│   │
│   └── web/            # Web服务
│       ├── server.ts   # Hono服务器
│       ├── routes/     # 路由
│       └── middleware/  # 中间件
│
├── docs/               # 文档
├── config/             # 配置文件
└── package.json
```

---

## 核心架构

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
│                            Router                                         │
└─────────────────────────────┬───────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          核心层 (Core)                                    │
│                    Session Manager ◄──► Event Bus                          │
└─────────────────────────────┬───────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Agent层 (Adapters)                               │
│                    Aider ◄──► Claude ◄──► Custom                          │
└─────────────────────────────┬───────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          工具层 (Tools)                                   │
│                       Shell ◄──► Git ◄──► File                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 前提条件

- Bun 1.3+
- Redis
- Linux服务器 (Ubuntu 24.04)

### 安装

```bash
# 安装Bun
curl -fsSL https://bun.sh/install | bash

# 安装依赖
bun install

# 配置环境变量
cp .env.example .env
# 编辑.env填写配置

# 开发模式
bun run dev

# 生产构建
bun run build
bun run start
```

---

## 配置

### 环境变量 (.env)

```bash
# 服务器
PORT=3000
HOST=0.0.0.0

# Redis
REDIS_URL=redis://localhost:6379

# Agent配置
AIDER_MODEL=openai/gpt-4o
CLAUDE_MODEL=claude-3-5-sonnet

# 飞书Bot
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx

# 安全
SESSION_SECRET=your-secret-key
```

---

## 使用方式

### 飞书Bot

1. 在飞书开放平台创建应用
2. 配置WebHook地址: `https://你的域名/feishu/webhook`
3. 启动服务后，在飞书@机器人即可交互

### Web界面

访问 `http://服务器IP:3000`

### SSH

```bash
ssh user@服务器IP
# 进入tmux会话
tmux attach -t agent
```

---

## 文档

| 文档 | 内容 |
|------|------|
| `docs/00-architecture.md` | 架构设计 (TS/Bun) |
| `docs/07-research.md` | 语言/框架调研报告 |

---

## 开发

```bash
# 类型检查
bun run typecheck

# 代码格式化
bun run format

# 测试
bun run test

# 构建
bun run build
```
