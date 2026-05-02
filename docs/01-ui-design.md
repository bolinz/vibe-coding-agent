# UI Design Document — Vibe Coding Agent

> Preact + TSX + CSS Variables 重构方案

---

## 1. 技术方案

| 层 | 选择 | 理由 |
|---|---|---|
| 框架 | Preact 10.x | 3KB, React 兼容 API, 无编译依赖 |
| 语言 | TypeScript (TSX) | 与后端共享类型, 编译期检查 |
| 构建 | `bun build --target=browser` | 零配置, 输出 ES module |
| 样式 | CSS Variables + 原生 CSS | 无需 CSS-in-JS, 运行时无开销 |
| 路由 | 双页面 `/` + `/config` | 完全独立 SPA, 无路由器依赖 |

---

## 2. 页面架构

```
GET /                    → index.html  → bun serve → 浏览器加载 chat.js
GET /config              → config.html → bun serve → 浏览器加载 config.js
GET /ui/chat.js          → dist/ui/chat.js    (编译后, ES module)
GET /ui/config.js        → dist/ui/config.js  (编译后, ES module)
```

两个 SPA 完全独立，不共享 JS bundle。

---

## 3. 布局结构

### 3.1 Chat 页面 (`/`)

```
┌──────────────────────────────────────────────────────────────┐
│ HEADER (h: 52px)                                             │
│  ☰ [toggle]   ◉ [conn]   AI Coding Agent     ❓ 💬 ⚙️    │
├──────────────┬───────────────────────────────────────────────┤
│ SIDEBAR      │ CHAT AREA                                     │
│ (w: 280px)   │                                               │
│              │  ┌─ Message List ──────────────────────────┐  │
│ 📋 会话      │  │ user 14:23                             │  │
│ [+]          │  │ ┌──────────────────────────────────┐  │  │
│              │  │ │ Hello                           │  │  │
│ hermes 9a3b  │  │ └──────────────────────────────────┘  │  │
│ 5 条消息     │  │                                         │  │
│ 📂 /pro...   │  │ assistant 14:23                        │  │
│ [echo ▼] 📍  │  │ ┌──────────────────────────────────┐  │  │
│              │  │ │ Hi! How can I help?              │  │  │
│ echo 2c1f    │  │ └──────────────────────────────────┘  │  │
│ 3 条消息     │  │                                         │  │
│ 📂 /tmp      │  │ ◇ hermes 正在思考... ● ● ●             │  │
│ [hermes ▼]   │  └───────────────────────────────────────┘  │
│              │                          [ ↓ ]              │
│              │  ┌─ Input Bar ──────────────────────────┐  │
│              │  │  输入消息...          ⏹  [ 发送 ]   │  │
│              │  └───────────────────────────────────────┘  │
└──────────────┴───────────────────────────────────────────────┘
```

### 3.2 Config 页面 (`/config`)

```
┌──────────────────────────────────────────────────────────────┐
│ HEADER                                                       │
│  ← 返回 Chat           ⚙️ 系统配置           🟢 已连接    │
├───────────┬──────────────────────────────────────────────────┤
│ NAV       │ CONTENT (scrollable)                             │
│           │                                                   │
│ ┌───────┐ │  ┌───────────────────────────────────────────┐   │
│ │ 🤖   │ │  │ AI 服务配置                              │   │
│ │  AI   │ │  ├───────────────────────────────────────────┤   │
│ ├───────┤ │  │ OpenAI Key     [••••••••••••••••••]  👁  │   │
│ │ ⚙️   │ │  │ Anthropic Key  [••••••••••••••••••]  👁  │   │
│ │ Agent │ │  └───────────────────────────────────────────┘   │
│ ├───────┤ │                                                   │
│ │ 🔗   │ │  ┌───────────────────────────────────────────┐   │
│ │ 通道  │ │  │ Agent 设置                               │   │
│ ├───────┤ │  ├───────────────────────────────────────────┤   │
│ │ 🖥   │ │  │ 默认 Agent    [echo ▼]                    │   │
│ │ 系统  │ │  │ 工作目录      [/projects/sandbox ✏️]     │   │
│ └───────┘ │  │ 容器引擎      [docker ▼]                 │   │
│           │  └───────────────────────────────────────────┘   │
│           │                                                   │
│           │  ┌───────────────────────────────────────────┐   │
│           │  │ GitHub 配置                               │   │
│           │  ├───────────────────────────────────────────┤   │
│           │  │ Token     [••••••••••••••••••••••]  👁   │   │
│           │  │ App ID    [cli_xxxxxxxxxxxx]              │   │
│           │  │ 密钥      [••••••••••••]            👁   │   │
│           │  │ HMAC      [••••••••]                👁   │   │
│           │  │ ◉ 已配置 · [测试连接]                     │   │
│           │  └───────────────────────────────────────────┘   │
│           │                                                   │
│           │  ┌───────────────────────────────────────────┐   │
│           │  │ 飞书机器人连接                            │   │
│           │  ├───────────────────────────────────────────┤   │
│           │  │ ┌─── QR ───┐  ◉ 已连接                    │   │
│           │  │ │ 160x160 │  App: cli_a965...             │   │
│           │  │ └──────────┘  [重新扫码] [测试连接]        │   │
│           │  └───────────────────────────────────────────┘   │
│           │                                                   │
│           │  ┌───────────────────────────────────────────┐   │
│           │  │ 系统配置                                  │   │
│           │  ├───────────────────────────────────────────┤   │
│           │  │ 端口     [3000]               ⚠️ 需重启  │   │
│           │  │ 监听地址 [0.0.0.0]            ⚠️ 需重启  │   │
│           │  │ Redis    [redis://localhost]  ⚠️ 需重启  │   │
│           │  └───────────────────────────────────────────┘   │
├───────────┴──────────────────────────────────────────────────┤
│ FLOATING ACTION BAR                                          │
│    [ ↺ 重置为默认 ]                   [ 💾 保存并热加载 ]  │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 组件树

### Chat App

```
App                          ← state: { currentSessionId, sessions, messages, sse, connStatus }
├── Header
│   ├── SidebarToggle        ← onClick: toggle sidebar collapsed
│   ├── ConnDot              ← prop: status ('on'|'ws'|'off')
│   ├── Title
│   └── NavLinks             ← <a href="/config">⚙️</a>
│
├── Sidebar                  ← prop: collapsed, sessions, currentSessionId
│   ├── SidebarHeader
│   │   ├── Title ("📋 会话")
│   │   └── NewSessionBtn    ← onClick: createSession()
│   └── SessionList
│       └── SessionItem[]    ← prop: session, isActive, onClick, onPin, onDelete, onAgentChange, onWDDblclick
│           ├── SessionName  ← {agentType} {id[:8]} {channelIcons}
│           ├── SessionMeta  ← {messageCount}条 · {time}
│           ├── WorkingDir   ← dblclick → <input> → save
│           ├── AgentSelect  ← <select> onChange → switchAgent
│           ├── PinBtn       ← onClick → togglePin
│           └── DelBtn       ← onClick → deleteSession (撤销 toast)
│
├── ChatArea                 ← prop: messages, isNearBottom
│   ├── ScrollBottomBtn      ← visible when !isNearBottom
│   ├── MessageList
│   │   ├── MessageBubble[]  ← prop: role, content, timestamp
│   │   │   ├── Avatar       ← 首字母圆圈 (user=U, assistant=A)
│   │   │   ├── Content
│   │   │   └── Timestamp    ← title attr, hover显示
│   │   ├── SystemMessage    ← 居中灰色文本
│   │   └── ErrorMessage     ← 红底
│   └── TypingIndicator      ← prop: statusText
│       ├── AgentName
│       └── Dots (3span)
│
└── InputBar                 ← prop: onSend, onCancel, isSending, isRunning
    ├── CancelBtn            ← visible when isRunning
    ├── TextInput            ← onKeyDown: Enter=send
    └── SendBtn              ← disabled when isSending, show ⏳
```

### Config App

```
App                          ← state: { activeTab, configEntries, feishuConnected }
├── Header
│   ├── BackLink             ← <a href="/">← 返回 Chat</a>
│   └── Title
│
├── NavSidebar
│   └── NavItem[]            ← prop: icon, label, isActive, onClick
│
├── Content
│   ├── ConfigSection[]      ← prop: title, children
│   │   └── ConfigRow[]      ← prop: label, description, inputType, value, onChange, restartTag
│   │       ├── Label
│   │       ├── Description
│   │       ├── Input/PWInput  ← type=text|password, 👁 toggle
│   │       └── RestartTag     ← "需重启" badge
│   ├── ConfigSection(Feishu)
│   │   └── FeishuCard       ← QR code + status + buttons
│   └── ConfigSection(GitHub)
│       └── ConfigRow×4 + Status
│
└── ActionBar
    ├── ResetBtn
    └── SaveBtn
```

---

## 5. 交互设计

### 5.1 消息动画

```css
@keyframes msgIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.message { animation: msgIn 0.2s ease-out; }
```

### 5.2 Session 切换

```
点击 session-item
  → MessageList fadeOut (150ms opacity 0)
  → loadMessages(sessionId)
  → MessageList fadeIn (200ms opacity 1)
```

### 5.3 输入区

```
Enter              → send()
Shift+Enter        → 换行 (默认行为)
发送中:
  button disabled
  text = "⏳"
  input disabled
完成后:
  button enabled
  text = "发送"
  input enabled, focus
```

### 5.4 工作目录编辑

```
dblclick .session-wd
  → span → input (自动 focus + select)
  → Enter         → save + re-render
  → Escape        → cancel + re-render
  → blur          → save
```

### 5.5 删除会话 (撤销)

```
点击 ×
  → items 灰显 + 撤销 toast "会话 xxx 已关闭 [撤销]"
  → 3s 内点击撤销 → 取消删除
  → 3s 超时     → 调 API 删除

CSS: .session-item-deleting { opacity: 0.5; pointer-events: none; }
```

### 5.6 Config 保存

```
点击保存
  → button state = "⏳ 保存中..."
  → POST /api/config/batch
  → POST /api/config/reload
  → button state = "✓ 已保存" (绿色, 2s)
  → 恢复 "💾 保存配置"
```

---

## 6. CSS 变量主题

```css
:root {
  /* 颜色 */
  --bg-app:          #0b0b1a;
  --bg-surface:      #12122a;
  --bg-elevated:     #1a1a3e;
  --bg-input:        #0a0a1e;
  --bg-hover:        rgba(0,217,255,0.04);

  --border-subtle:   rgba(15,52,96,0.35);
  --border-default:  rgba(15,52,96,0.6);

  --text-primary:    #e8e8f0;
  --text-secondary:  #9999bb;
  --text-muted:      #666688;
  --text-accent:     #61e8ff;

  --accent:          #00d9ff;
  --accent-glow:     rgba(0,217,255,0.2);
  --accent-dim:      rgba(0,217,255,0.08);
  --success:         #34d399;
  --warning:         #fbbf24;
  --danger:          #f87171;

  /* 布局 */
  --sidebar-w:       280px;
  --header-h:        52px;
  --input-bar-h:     64px;
  --radius-sm:       6px;
  --radius-md:       12px;
  --radius-lg:       20px;

  /* 阴影 */
  --shadow-sm:       0 1px 3px rgba(0,0,0,0.4);
  --shadow-md:       0 4px 12px rgba(0,0,0,0.5);
  --shadow-lg:       0 8px 32px rgba(0,0,0,0.6);

  /* 字体 */
  --font:            'Inter', -apple-system, sans-serif;
  --font-mono:       'JetBrains Mono', 'Fira Code', monospace;
}

@media (max-width: 768px) {
  :root {
    --sidebar-w: 0px;  /* sidebar hidden, overlay */
    --header-h: 48px;
  }
}
```

---

## 7. 文件清单

```
src/web/ui/
├── index.html                    # Chat 入口 (HTML壳)
├── config.html                   # Config 入口 (HTML壳)
├── styles/
│   ├── variables.css             # CSS 变量 + 主题
│   ├── base.css                  # Reset + 排版 + 滚动条
│   ├── chat.css                  # Chat 布局 + 组件样式
│   └── config.css                # Config 布局 + 组件样式
├── shared/
│   ├── api.ts                    # 类型化 fetch
│   ├── types.ts                  # 前端类型
│   └── utils.ts                  # formatTime, escapeHtml
├── pages/chat/
│   ├── App.tsx                   # 根组件
│   ├── Header.tsx                # 顶栏
│   ├── Sidebar.tsx               # 侧栏
│   ├── ChatArea.tsx              # 聊天区
│   ├── MessageList.tsx           # 消息列表
│   ├── MessageBubble.tsx         # 消息气泡
│   ├── InputBar.tsx              # 输入区
│   └── TypingIndicator.tsx       # 打字指示器
└── pages/config/
    ├── App.tsx                   # 根组件
    ├── Header.tsx                # 顶栏
    ├── NavSidebar.tsx            # 分类导航
    ├── ConfigSection.tsx         # 卡片容器
    ├── ConfigRow.tsx             # 配置项
    ├── FeishuCard.tsx            # 飞书连接
    └── ActionBar.tsx             # 操作栏
```

---

## 8. 响应式断点

| 断点 | 行为 |
|------|------|
| > 768px | 标准布局, sidebar 280px |
| ≤ 768px | sidebar 隐藏, hamburger 按钮出现, overlay 展开 |
| ≤ 480px | header 高度减少, 输入区 padding 缩小 |
