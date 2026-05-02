# UI Design Document — Vibe Coding Agent

> 现代极简风格 — Preact + TSX + Lucide Icons + CSS Variables

---

## 1. 技术方案

| 层 | 选择 | 理由 |
|---|---|---|
| 框架 | Preact 10.x | 3KB, React 兼容 API |
| 图标 | lucide-preact | 线条图标, tree-shakeable |
| 语言 | TypeScript (TSX) | 与后端共享类型 |
| 构建 | `bun build --target=browser` | 零配置, ES module |
| 样式 | CSS Variables + 原生 CSS | 无运行时开销 |
| 路由 | 双页面 `/` + `/config` | 完全独立 SPA |

---

## 2. 设计理念

风格参考: Vercel / Linear / Raycast

| 维度 | 方案 |
|------|------|
| 背景 | 白色/浅灰 (`#fafafa` / `#ffffff`) |
| 强调色 | 纯黑 (`#111827`) |
| 图标 | Lucide 线条图标 (替换所有 emoji) |
| 排版 | 大留白、呼吸感、清晰层级 |
| 气泡 | 纯色背景 + 细边框 (assistant), 黑底白字 (user) |
| 阴影 | 极轻 (`0 1px 3px rgba(0,0,0,0.06)`) |

---

## 3. 颜色方案

```css
:root {
  --bg-app:        #fafafa;
  --bg-surface:    #ffffff;
  --bg-elevated:   #f5f5f5;
  --bg-hover:      #f3f4f6;
  --border-subtle: #f0f0f0;
  --border-default:#e5e7eb;
  --border-focus:  #111827;
  --text-primary:  #111827;
  --text-secondary:#6b7280;
  --text-muted:    #9ca3af;
  --accent:        #111827;
  --success:       #10b981;
  --warning:       #f59e0b;
  --danger:        #ef4444;
}
```

---

## 4. 图标映射

| 位置 | Emoji (旧) | Lucide (新) |
|------|------------|-------------|
| Header toggle | ☰ / ✕ | Menu / X |
| Header nav | 💬 ⚙️ | MessageCircle / Settings |
| Sidebar title | 📋 | (纯文字 "Sessions") |
| Sidebar new | + | Plus |
| Channel: feishu | 📱 | Smartphone |
| Channel: web | 🌐 | Globe |
| Channel: ssh | 💻 | Terminal |
| Session pin | 📌/📍 | Pin / PinOff |
| Session delete | × | X |
| Working dir | (无) | Folder |
| Scroll bottom | ↓ | ChevronDown |
| Cancel | ⏹ | Square |
| Send | 发送 | SendHorizonal |
| Config nav | 🤖⚙️🔗🖥 | Bot/Settings/Link/Monitor |
| Password | 👁 | Eye / EyeOff |
| Save | 💾 | Save |
| Reset | ↺ | RotateCcw |
| Feishu status | ◉ | CheckCircle / XCircle |
| Feishu test | (无) | RefreshCw |
| Feishu scan | (无) | QrCode |

---

## 5. 布局结构

### 5.1 Chat 页面

```
┌───────────────────────────────────────────────────────────┐
│ HEADER (h: 48px, white, bottom border)                    │
│  [☰]  AI Coding Agent  ●     [💬] [⚙️]                  │
├───────────┬───────────────────────────────────────────────┤
│ SIDEBAR   │ CHAT AREA (bg: #fafafa)                       │
│ (w: 260px)│                                               │
│           │  ┌─ user ─────────────────────────────────┐  │
│ SESSIONS  │  │ [U] Hello                          14:23│  │
│ [+]       │  └────────────────────────────────────────┘  │
│           │                                               │
│ opencode  │  ┌─ assistant ────────────────────────────┐  │
│ 9a3b  5条 │  │ [A] Hi! How can I help?          14:23│  │
│ /projects │  └────────────────────────────────────────┘  │
│ [echo ▼]  │                                               │
│           │  · · ·  正在思考...                            │
│ echo 2c1f │                          [↓]                  │
│ 3条       │  ┌─ Input ────────────────────────────────┐  │
│ /tmp      │  │  [输入消息...]              [发送 →]   │  │
│ [hermes▼] │  └────────────────────────────────────────┘  │
└───────────┴───────────────────────────────────────────────┘
```

### 5.2 Config 页面

```
┌───────────────────────────────────────────────────────────┐
│ HEADER                                                     │
│  ← 返回 Chat    系统配置                                   │
├─────────┬─────────────────────────────────────────────────┤
│ NAV     │ CONTENT (scrollable)                            │
│         │                                                  │
│ [🤖] AI │  ┌─ AI 服务配置 ─────────────────────────────┐  │
│ [⚙️]Agent│  │ openai_key     [••••••••••] [👁]         │  │
│ [🔗]通道 │  │ anthropic_key  [••••••••••] [👁]         │  │
│ [🖥]系统 │  └──────────────────────────────────────────┘  │
│         │                                                  │
│         │  ┌─ 飞书机器人 ──────────────────────────────┐  │
│         │  │ [QR]  ● 已连接                             │  │
│         │  │       [测试连接] [重新扫码]                │  │
│         │  └──────────────────────────────────────────┘  │
├─────────┴─────────────────────────────────────────────────┤
│  [↺ 重置]                              [💾 保存配置]     │
└───────────────────────────────────────────────────────────┘
```

---

## 6. 文件清单

```
src/web/ui/
├── index.html / config.html
├── styles/
│   ├── variables.css    # 色板 + 布局 + 字体
│   ├── base.css         # Reset + 通用
│   ├── chat.css         # Chat 样式
│   └── config.css       # Config 样式
├── shared/
│   ├── api.ts           # 类型化 fetch
│   ├── types.ts         # 前端类型
│   └── utils.ts         # 工具函数
└── pages/
    ├── chat/
    │   ├── App.tsx
    │   ├── Header.tsx       # Menu/X + MessageCircle/Settings
    │   ├── Sidebar.tsx      # Plus/X/Pin/PinOff/Folder + Smartphone/Globe/Terminal
    │   ├── ChatArea.tsx     # ChevronDown
    │   ├── MessageList.tsx
    │   ├── MessageBubble.tsx
    │   ├── InputBar.tsx     # SendHorizonal/Square
    │   └── TypingIndicator.tsx
    └── config/
        ├── App.tsx
        ├── Header.tsx       # ArrowLeft
        ├── NavSidebar.tsx   # Bot/Settings/Link/Monitor
        ├── ConfigSection.tsx
        ├── ConfigRow.tsx    # Eye/EyeOff
        ├── FeishuCard.tsx   # CheckCircle/XCircle/RefreshCw/QrCode
        └── ActionBar.tsx    # RotateCcw/Save/Check
```

---

## 7. 响应式断点

| 断点 | 行为 |
|------|------|
| > 768px | 标准布局, sidebar 260px |
| ≤ 768px | sidebar 隐藏, hamburger 出现, overlay 展开 |
| ≤ 480px | header 44px, 输入区 padding 缩小 |
