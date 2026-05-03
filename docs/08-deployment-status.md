# 部署指南

> 更新时间: 2026-05-03

---

## 1. 服务器环境

| 项目 | 示例值 |
|------|--------|
| **操作系统** | Fedora Linux 43.1.6 (Silverblue) |
| **部署用户** | `<REMOTE_USER>` |
| **部署路径** | `<REMOTE_DIR>` (如 `/var/home/<REMOTE_USER>/vibe-agent`) |
| **Bun 版本** | 1.3.13 |
| **Bun 路径** | `<REMOTE_DIR>/../.bun/bin/bun` |
| **Node 路径** | `<REMOTE_DIR>/../.local/bin/node` (v22.14.0) |
| **运行方式** | `bun run dist/index.js` (nohup) |
| **监听端口** | 3000 |
| **Redis** | Podman 容器, `docker.io/library/redis:alpine`, 端口 6379 |
| **健康检查** | `http://<REMOTE_HOST>:3000/health` |

---

## 2. 前置依赖

### 2.1 Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

安装后路径: `~/.bun/bin/bun`

### 2.2 Redis (可选)

生产环境建议启用 Redis 实现会话持久化:

```bash
podman run -d --name redis -p 6379:6379 docker.io/library/redis:alpine
```

### 2.3 Node.js (Agent 运行所需)

部分 Agent (如 `opencode`) 是 Node.js 脚本，需要 Node.js:

```bash
# 通过 fnm 或 nvm 安装
fnm install 22
```

安装路径: `~/.local/bin/node`

### 2.4 Agent CLI 工具

| Agent | 安装方式 | 安装路径 | 状态 |
|-------|----------|----------|------|
| `echo` | 系统自带 | `/usr/bin/echo` | ✅ |
| `opencode` | npm | `~/.local/bin/opencode` | ✅ |
| `claude` | npm | `~/.local/bin/claude` | ✅ |
| `hermes` | pip | `~/.local/bin/hermes` | ✅ |
| `codex` | npm | `~/.local/bin/codex` | ❌ 未安装 |
| `cline` | npm | `~/.local/bin/cline` | ❌ 未安装 |
| `aider` | pip | `~/.local/bin/aider` | ❌ 未安装 |

> Agent 通过环境变量 `DEFAULT_AGENT` 设置默认值，缺省为 `echo`。

---

## 3. 首次部署

```bash
# 1. 登录服务器
ssh <REMOTE_USER>@<REMOTE_HOST>

# 2. 初始化 Bun (如果未安装)
curl -fsSL https://bun.sh/install | bash

# 3. 克隆或上传代码
git clone <REPO_URL> <REMOTE_DIR>
# 或使用 rsync 从本地同步
rsync -avz --exclude node_modules --exclude .git --exclude projects/ \
  /local/path/to/vibe-coding-agent/ \
  <REMOTE_USER>@<REMOTE_HOST>:<REMOTE_DIR>/

# 4. 安装依赖
cd <REMOTE_DIR>
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
bun install

# 5. 编译
bun run build

# 6. 部署 Feishu Sidecar 二进制
# 见第 8 节

# 7. 配置环境变量
cp .env.example .env
# 编辑 .env, 设置 SESSION_SECRET、API Key 等

# 8. 启动
nohup bun run dist/index.js > app.log 2>&1 &

# 9. 验证
sleep 2 && curl -s http://localhost:3000/health
```

---

## 4. 代码更新流程

```bash
# 本地构建前端
cd /local/path/to/vibe-coding-agent
bun run build:ui

# 同步源码到远程
rsync -avz --exclude node_modules --exclude .git --exclude projects/ \
  /local/path/to/vibe-coding-agent/ \
  <REMOTE_USER>@<REMOTE_HOST>:<REMOTE_DIR>/

# 远程重新构建并重启
ssh <REMOTE_USER>@<REMOTE_HOST>
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
cd <REMOTE_DIR>

# 如有新依赖
bun install

# 编译后端和前端
bun run build

# 重启
kill $(lsof -ti:3000)
sleep 1
nohup bun run dist/index.js > app.log 2>&1 &

# 验证
sleep 2 && curl -s http://localhost:3000/health
```

### 一键部署脚本

```bash
# 本地执行
rsync -avz --exclude node_modules --exclude .git --exclude projects/ \
  /local/path/ <REMOTE_USER>@<REMOTE_HOST>:<REMOTE_DIR>/ && \
ssh <REMOTE_USER>@<REMOTE_HOST> \
  "export BUN_INSTALL=\"\$HOME/.bun\" && export PATH=\"\$BUN_INSTALL/bin:\$PATH\" && \
   cd <REMOTE_DIR> && bun run build 2>&1 | tail -3 && \
   kill \$(lsof -ti:3000) 2>/dev/null; sleep 1 && \
   nohup bun run dist/index.js > app.log 2>&1 & \
   sleep 2 && curl -s http://localhost:3000/health"
```

---

## 5. 环境变量配置

### 5.1 `.env` 模板

```bash
PORT=3000
HOST=0.0.0.0
DEFAULT_AGENT=echo
SESSION_SECRET=change-me-in-production-at-least-32-characters
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=
OPENAI_API_BASE=https://api.minimax.chat/v1
```

### 5.2 `SESSION_SECRET` 说明

`SESSION_SECRET` 用于 SQLite 中加密字段（如 `feishu_app_secret`）的 XOR 加密。

**必须遵守的规则：**
- 长度至少 32 字符
- 本地和远程**必须一致**（否则加密字段无法解密）
- 首次配置后不要随意更改（更改后需重新保存所有加密配置项）

**密钥不一致的后果：** SQLite 中的 `feishu_app_secret` 乱码 → 飞书连接失败。修复方法：

```bash
cd <REMOTE_DIR>
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# 在 .env 中设置正确的 SESSION_SECRET 后
bun -e "
const { ConfigManager } = require('./src/core/config');
const cm = new ConfigManager();
cm.set('feishu_app_secret', 'your-correct-secret');
console.log('Fixed');
"
```

### 5.3 配置管理页面

应用运行后，可通过 Web UI 管理配置：

```
http://<REMOTE_HOST>:3000/config
```

配置项持久化在 SQLite 中（加密存储），通过 `POST /api/config/batch` API 热加载。

---

## 6. 服务管理

### 6.1 进程管理

| 操作 | 命令 |
|------|------|
| 启动 | `nohup bun run dist/index.js > app.log 2>&1 &` |
| 停止 | `kill $(lsof -ti:3000)` |
| 重启 | 先停止再启动 |
| 查看进程 | `lsof -ti:3000` |
| 进程信息 | `ps -p $(lsof -ti:3000) -o user,pid,lstart,cmd` |

### 6.2 日志

```bash
# 实时日志
tail -f <REMOTE_DIR>/app.log

# 搜索关键事件
grep -E 'Agent error|Agent response|Error|error' <REMOTE_DIR>/app.log

# 检查 Feishu 状态
grep -i feishu <REMOTE_DIR>/app.log
```

### 6.3 健康检查

```bash
curl -s http://<REMOTE_HOST>:3000/health
```

返回示例:

```json
{
  "status": "ok",
  "timestamp": "2026-05-03T02:46:35.623Z",
  "wsConnections": 2,
  "channels": [
    {"type": "websocket", "connected": true},
    {"type": "ssh", "connected": true},
    {"type": "webhook", "connected": true},
    {"type": "mcp", "connected": true},
    {"type": "feishu", "connected": true}
  ]
}
```

所有 5 个通道均显示 `connected: true` 为正常。

### 6.4 进程环境变量检查

如果进程运行异常，检查其环境变量:

```bash
cat /proc/$(lsof -ti:3000)/environ | tr '\0' '\n' | grep -E '^HOME=|^PATH=|^SESSION_SECRET='
```

---

## 7. Silverblue 兼容性

目标服务器为 **Fedora Silverblue**（不可变操作系统）。部署时需注意以下差异：

### 7.1 只读根文件系统

根目录 (`/`) 为 composefs 只读挂载，**无法创建目录**:

```bash
# 会失败: mkdir /workspace
# 应该使用: mkdir <REMOTE_DIR>/projects/sandbox
```

**影响：** Session 的 `workingDir` 如果指向 `/workspace` 等路径，`bun spawn` 会因 `cwd` 不存在而报 `ENOENT`。

**解决方案（代码层面）：**
- `src/agents/runtime/cli.ts:92-94` — spawn 前验证 `cwd` 存在，否则回退到 `$HOME` 或 `/tmp`
- Session 的默认工作目录应设为 `<REMOTE_DIR>/projects/sandbox` 等可写路径

### 7.2 PATH 限制

Silverblue 的非交互式 shell (SSH 命令、nohup) 启动时 PATH 不包含 `~/.local/bin`:

```bash
# 交互式 SSH 的 PATH:
# /var/home/<REMOTE_USER>/.local/bin:/usr/local/bin:/usr/bin

# nohup 启动的进程 PATH:
# /usr/local/bin:/usr/bin
```

**影响：** Agent 命令（如 `opencode`、`claude`）安装于 `~/.local/bin`，在服务进程中无法被 `spawn` 找到。

**解决方案（代码层面）：**
- `src/agents/runtime/cli.ts:67-68` — spawn 前将 `$HOME/.local/bin` 和 `$HOME/.bun/bin` 注入 PATH

### 7.3 可写目录

| 用途 | 路径 | 说明 |
|------|------|------|
| 项目文件 | `<REMOTE_DIR>/` | 用户 home，可写 |
| 工作目录 | `<REMOTE_DIR>/projects/sandbox` | session 的默认 workingDir |
| 日志 | `<REMOTE_DIR>/app.log` | 应用日志 |
| 临时文件 | `/tmp` | 可用 |
| 根目录 | `/` | ❌ 只读 |

---

## 8. Feishu Sidecar 部署

### 8.1 二进制位置

Sidecar 二进制必须放置在以下路径之一（按优先级）：

1. `<REMOTE_DIR>/plugins/feishu/sidecar`（推荐）
2. `<BUN_EXEC_DIR>/plugins/feishu/sidecar`
3. `~/.vibe-agent/plugins/feishu/sidecar`

### 8.2 部署命令

```bash
# 本地构建或从 release 下载
# 或使用 sidecars/feishu/ 目录下的预编译二进制

# 复制 Linux amd64 二进制到部署路径
mkdir -p <REMOTE_DIR>/plugins/feishu
cp sidecars/feishu/feishu-sidecar-linux-amd64 <REMOTE_DIR>/plugins/feishu/sidecar
chmod +x <REMOTE_DIR>/plugins/feishu/sidecar

# 验证
file <REMOTE_DIR>/plugins/feishu/sidecar
# 输出: ELF 64-bit LSB executable, x86-64, statically linked
```

### 8.3 跨平台注意事项

| 平台 | 二进制 | 说明 |
|------|--------|------|
| macOS ARM64 | `sidecars/feishu/feishu-sidecar` | 本地开发 |
| Linux amd64 | `sidecars/feishu/feishu-sidecar-linux-amd64` | 服务器部署 |

**将 Linux 二进制部署为 `plugins/feishu/sidecar`**，sidecar loader 会按此路径查找。

### 8.4 启动验证

```bash
# 重启应用后检查日志
grep -i sidecar <REMOTE_DIR>/app.log
# 应看到:
# [Feishu] Using Sidecar mode
# [Sidecar stderr] Starting feishu-sidecar
# [Sidecar stderr] Feishu WebSocket connected
# [FeishuSidecar] Connected via Go sidecar

# 确认健康检查
curl -s http://localhost:3000/health | grep feishu
# 应显示: "feishu","connected":true
```

---

## 9. 前端构建与部署

### 9.1 构建命令

```bash
# 仅编译前端
bun run build:ui

# 编译全部（后端 + 前端）
bun run build
```

`build:ui` 做的事情:

```bash
bun build src/web/ui/pages/chat/App.tsx   --outfile=dist/ui/chat.js   --target=browser
bun build src/web/ui/pages/config/App.tsx --outfile=dist/ui/config.js --target=browser
cp src/web/ui/styles/*.css dist/ui/
```

### 9.2 静态资源路由

服务器通过 `GET /ui/*` 提供 `dist/ui/` 目录下的静态文件:

| URL | 文件 | 说明 |
|-----|------|------|
| `/` | `dist/ui/chat.js` + `dist/ui/chat.css` | Chat SPA |
| `/config` | `dist/ui/config.js` + `dist/ui/config.css` | Config SPA |
| `/ui/chat.js` | `dist/ui/chat.js` | 编译后约 116KB |
| `/ui/config.js` | `dist/ui/config.js` | 编译后约 44KB |

### 9.3 CSS 导入链

```
chat.css  ──@import──→ variables.css  (色板/布局/字体)
               └──→ base.css         (reset/通用样式)

config.css ──@import──→ variables.css
               └──→ base.css
```

CSS 通过 `@import` 链式加载，浏览器自动解析相对路径。

### 9.4 前端依赖

| 依赖 | 用途 | 大小 |
|------|------|------|
| preact | 框架 | 3KB |
| lucide-preact | 图标 | tree-shakeable |
| marked | Markdown 渲染 | ~64KB |

---

## 10. 已知问题与修复记录

### 10.1 当前问题

| 问题 | 影响 | 状态 |
|------|------|------|
| Claude Code 未登录 | `claude` Agent 不可用 | ❌ |
| Aider 未安装 | `aider` Agent 不可用 | ❌ |
| Codex/Cline 未安装 | `codex`/`cline` Agent 不可用 | ❌ |
| Redis 未启用 | 进程重启后会话丢失 | ❌ |

### 10.2 修复记录

| 日期 | 问题 | 根因 | 修复 |
|------|------|------|------|
| 2026-05-02 | `[object Object]` 错误 | `server.ts` 直接将 `event.data` (object) 作为 SSE error content | 提取 `.error`/`.message` 字段 |
| 2026-05-02 | `ENOENT posix_spawn 'opencode'` | Session 的 `workingDir` 指向不存在的 `/workspace`；PATH 不含 `~/.local/bin` | cwd 回退逻辑 + PATH 注入 |
| 2026-05-02 | 飞书连接断开 | Sidecar 二进制未部署到 `plugins/feishu/sidecar` | 复制 Linux ELF 二进制到 plugins 目录 |
| 2026-05-02 | CSS 样式失效 | `base.css` 未被任何 HTML 加载（`chat.css`/`config.css` 只 import `variables.css`） | 添加 `@import './base.css'` |
| 2026-05-02 | Config 页面无样式 | Toast class 名错配 `class="toast"` vs CSS `.config-toast` | 统一为 `config-toast` |
| 2026-05-02 | Config header 含 emoji | `←` 硬编码字面符而非 Lucide `ArrowLeft` | 替换为 `<ArrowLeft size={14} />` |

### 10.3 部署注意事项总结

```
┌────────────────────────────────────────────────────────────┐
│ 部署检查清单                                                │
│                                                            │
│ 每次部署前确认:                                              │
│  □ `bun run build` 通过                                     │
│  □ `bun run typecheck` 通过                                 │
│  □ `bun test` 全部通过 (75 tests)                           │
│  □ dist/ui/ 包含最新 CSS + JS                               │
│  □ plugins/feishu/sidecar 存在 (如使用飞书)                 │
│  □ .env 中 SESSION_SECRET 与服务端一致                      │
│  □ 重启后 health check 显示所有通道 connected: true          │
└────────────────────────────────────────────────────────────┘
```
