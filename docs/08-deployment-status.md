# 部署状态报告

**更新时间**: 2026-04-29

---

## Agent 架构重构（2026-04-28）

### 重构目标
将 Agent 从"自定义执行类"重构为"纯配置管理 + 通用 Runtime 执行"架构。

### 新架构总览

```
src/agents/
├── manager.ts              # AgentManager — 注册/查询/切换（纯声明式）
├── types.ts                # Agent 配置描述
├── runtime/
│   ├── types.ts            # RuntimeAdapter 接口
│   ├── registry.ts         # RuntimeRegistry
│   ├── cli.ts              # CLIRuntime（一次性进程：claude/codex/cline/hermes）
│   └── session.ts          # SessionRuntime（持久会话：aider + tmux）
└── pipeline/
    ├── executor.ts         # PipelineEngine — 编排执行
    └── tool-loop.ts        # ToolLoop — 多轮 tool calling 循环
```

### 关键变更

| 项目 | 旧架构 | 新架构 |
|------|--------|--------|
| Agent 定义 | 自定义 class + execute() | 纯声明式 `Agent` 配置对象 |
| 执行逻辑 | 分散在各 Agent class | 通用 `CLIRuntime` / `SessionRuntime` |
| 新增 CLI 工具 | 写新 class | 改配置即可 |
| Tool calling | Router 内硬编码 1 轮 | `ToolLoop` 多轮循环 |
| 流式 | 无 | `StreamChunk` + `AsyncGenerator` |
| SSE 超时 | 10s 断开 | `idleTimeout: 255` |

### 已注册 Agent

| 名称 | Runtime | 说明 |
|------|---------|------|
| `claude` | CLI | `claude -p`（非交互式） |
| `codex` | CLI | OpenAI Codex CLI |
| `cline` | CLI | Cline CLI |
| `hermes` | CLI | Hermes CLI（`-q '{message}' -Q`） |
| `aider` | Session | Aider + tmux 持久会话 |
| `echo` | CLI | Echo 测试 |

### 删除的旧文件
- `src/agents/base.ts`
- `src/agents/aider.ts`
- `src/agents/claude.ts`
- `src/agents/hermes.ts`
- `src/agents/echo.ts`

### 新增文件
- `src/agents/types.ts`
- `src/agents/manager.ts`
- `src/agents/runtime/types.ts`
- `src/agents/runtime/registry.ts`
- `src/agents/runtime/cli.ts`
- `src/agents/runtime/session.ts`
- `src/agents/pipeline/executor.ts`
- `src/agents/pipeline/tool-loop.ts`
- 测试：`manager.test.ts`, `registry.test.ts`, `cli.test.ts`, `pipeline.test.ts`

### 修改文件
- `src/core/types.ts` — `AgentType` 从 union 改为 `string`
- `src/core/registry.ts` — 删除 `AgentRegistry`
- `src/core/router.ts` — 接入 `PipelineEngine` + `AgentManager`
- `src/web/server.ts` — 增加 `idleTimeout: 255`
- `src/index.ts` — 声明式注册 6 个 Agent

---

## 部署环境

| 项目 | 信息 |
|------|------|
| **服务器** | `<REMOTE_HOST>`（内网服务器） |
| **操作系统** | Fedora Linux 43.1.6 (Silverblue) |
| **部署用户** | `<REMOTE_USER>` |
| **部署路径** | `<REMOTE_DIR>` |
| **运行方式** | `bun run dist/index.js` |
| **监听端口** | 3000 |

---

## 服务管理命令（生产环境）

```bash
# 查看应用日志
ssh <REMOTE_HOST> "tail -f <REMOTE_DIR>/app.log"

# 查看进程
ssh <REMOTE_HOST> "ps aux | grep bun | grep -v grep"

# 重启应用
ssh <REMOTE_HOST> "pkill -f 'bun run dist/index.js'; sleep 2; cd <REMOTE_DIR> && source ~/.bash_profile && nohup bun run dist/index.js > app.log 2>&1 &"

# 健康检查
curl -s http://<REMOTE_HOST>:3000/health
```

---

## Hermes Agent 调用验证

### 测试步骤

1. 连接 SSE 流：
```bash
curl -s -N http://<REMOTE_HOST>:3000/api/chat/<SESSION_ID>/sse
```

2. 发送消息：
```bash
curl -s -X POST http://<REMOTE_HOST>:3000/api/chat/<SESSION_ID> \
  -H "Content-Type: application/json" \
  -d '{"message":"你好","userId":"<USER_ID>"}'
```

### 测试结果

| 项目 | 结果 |
|------|------|
| HTTP POST | ✅ `{"success":true}` |
| SSE 流式响应 | ✅ 心跳 + 响应推送 |
| hermes CLI 执行 | ✅ `hermes chat -q '你好' -Q` |
| 响应延迟 | ~32s（hermes CLI 超时重试） |

### Hermes + llama.cpp 配置

已配置 hermes 使用本地 llama.cpp server：

```bash
# ~/.hermes/config.yaml
model:
  provider: auto
  base_url: http://192.168.100.182:8082
  default: gemma4-e4b-q4_k_m.gguf

# ~/.hermes/.env
OPENAI_API_KEY=dummy-key-for-llama-cpp
```

**原理：** 当 `base_url` 设置时，hermes 忽略 provider 直接调用该 endpoint（使用 `OPENAI_API_KEY` 认证）。llama.cpp server 提供 OpenAI-compatible API，`/v1/chat/completions` 端点已验证可用。

**响应示例：**
```
你好，我是一个名为 Hermes Agent 的智能 AI 助手...
```

---

## 端到端验证结果（重构后）

| 测试项 | 结果 |
|--------|------|
| 构建 | ✅ `bun build` 成功 (3.66 MB) |
| 类型检查 | ✅ `tsc --noEmit` 0 错误 |
| 单元测试 | ✅ 64 pass / 0 fail |
| Echo Agent | ✅ SSE 流式响应正常 |
| Hermes Agent | ✅ 通过 llama.cpp server 返回响应 |
| SSE idleTimeout | ✅ 255s，不再 10s 断开 |

---

## 架构组件状态（重构后）

```
┌─────────────────────────────────────────────────────────────┐
│ 客户端层                                                     │
│  浏览器 WebUI ✅   SSE ✅ (优先)   WebSocket ✅ (降级)       │
│  飞书 Bot ✅ (Sidecar)                            欢迎页 ✅  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 核心层                                                      │
│  Router ✅   SessionManager ✅   EventBus ✅                │
│  ConfigManager ✅   ConfigDB ✅ (SQLite)                     │
│  AgentManager ✅   ToolRegistry ✅                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Runtime 层                                                  │
│  CLIRuntime ✅ (claude/codex/cline/hermes/echo)            │
│  SessionRuntime ✅ (aider + tmux)                          │
│  RuntimeRegistry ✅                                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Pipeline 层                                                 │
│  PipelineEngine ✅   ToolLoop ✅   StreamChunk ✅           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 工具层                                                      │
│  ShellTool ✅   GitTool ✅   FileTool ✅                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 待完成配置

| 项目 | 状态 | 说明 |
|------|------|------|
| **Hermes llama.cpp** | ✅ 已配置 | `auto` provider + `base_url: 192.168.100.182:8082` |
| **Claude Code** | ❌ 未登录 | `claude` CLI 需运行 `/login` |
| **OPENAI_API_KEY** | ❌ 未配置 | Aider Agent 需要 |
| **飞书 Bot** | ✅ 已连接 | Sidecar 模式，Go 二进制 (feishu-sidecar-linux-amd64) |
| **Redis 持久化** | ❌ 未启用 | 当前 Memory 存储 |

---

## 环境变量配置

文件位置: `.env`

```bash
PORT=3000
HOST=0.0.0.0
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=your-api-key
OPENAI_API_BASE=https://api.minimax.chat/v1
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_VERIFICATION_TOKEN=
SESSION_SECRET=change-me-in-production-at-least-32-characters
```

---

## 已知问题

1. ~~**Hermes 未配置 provider**~~ ✅ 已配置 llama.cpp server (192.168.100.182:8082)
2. **Claude Code 未登录** — `claude` CLI 需要运行 `/login` 认证
3. **Aider 未安装** — 服务器上没有 `aider` 命令
4. **Redis 未启用** — 当前使用内存存储（进程重启数据丢失）
5. ~~**SSE 连接 10s 超时**~~ ✅ 已修复：`idleTimeout: 255`

---

## 部署踩坑记录

### ⚠️ 修改 src/ 文件后必须用 `bun run build`

**错误做法：** 修改 `src/index.ts` 后直接 `bun run src/index.ts`
**后果：** Bun 会缓存编译结果，导致修改不生效，调试时看到的一直是旧代码
**正确做法：**
```bash
# 修改 src/ 文件后
bun run build                    # 生成 dist/index.js
rsync -avz dist/index.js <REMOTE>:<DIR>/dist/
# 然后远程运行 bun run dist/index.js
```

### ⚠️ SESSION_SECRET 必须保持一致

**错误做法：** 本地和远程使用不同的 `.env` 或默认 `SESSION_SECRET`
**后果：** SQLite 中的加密字段（如 `feishu_app_secret`）使用 `SESSION_SECRET` 做 XOR 加密。密钥不一致会导致解密失败，飞书凭据变成乱码
**正确做法：**
```bash
# 1. 确保本地和远程使用相同的 SESSION_SECRET
# 2. 如果已经加密错乱，用正确的 SESSION_SECRET 重新保存
ssh <REMOTE> "cd <DIR> && source ~/.bash_profile && cat > fix.ts << 'EOF'
import { ConfigManager } from './src/core/config';
const cm = new ConfigManager();
// 用正确的明文 secret 重新加密保存
cm.set('feishu_app_secret', 'your-correct-secret');
EOF
bun run fix.ts && rm fix.ts"
```

### ⚠️ Feishu Sidecar 跨平台二进制

**问题：** `sidecars/feishu/feishu-sidecar` 是 macOS ARM64 二进制，在 Linux 上执行报 `ENOEXEC`
**解决：** `findSidecarBinary()` 现在优先查找平台特定二进制（如 `feishu-sidecar-linux-amd64`），回退到通用名称时使用 `fs.realpathSync()` 解析符号链接
**服务器端确保：**
```bash
ls -la sidecars/feishu/
# 应该看到：
# feishu-sidecar -> feishu-sidecar-linux-amd64 (符号链接)
# 或直接使用 feishu-sidecar-linux-amd64
```

### ⚠️ Feishu 凭据配置检查清单

如果飞书消息无回应，按顺序检查：

```bash
ssh <REMOTE> "cd <DIR> && source ~/.bash_profile && cat > check.ts << 'EOF'
import { ConfigManager } from './src/core/config';
const cm = new ConfigManager();
console.log('feishu_app_id:', cm.get('feishu_app_id'));
console.log('feishu_app_secret valid:', cm.get('feishu_app_secret')?.length === 32);
console.log('feishu_domain:', cm.get('feishu_domain') || 'feishu (default)');
EOF
bun run check.ts && rm check.ts"

# 测试 token 获取
curl -s -X POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal \
  -H "Content-Type: application/json" \
  -d '{"app_id":"cli_xxx","app_secret":"your-secret"}'
# 应该返回 {"code":0,"tenant_access_token":"t-xxx"}
```

**飞书后台必须配置：**
1. **事件订阅** → 添加事件 `im.message.receive_v1`
2. **权限管理** → 开启 `im:chat:readonly`、`im:message:send_as_bot`
3. **机器人能力** → 开启「接收消息」

---

## 下一步

1. 配置 Claude Code：运行 `claude /login`
2. 安装 Aider：`pip install aider-chat`
3. 启用 Redis：`docker-compose up -d redis`
4. Channel 架构重构: 提取共享卡片/菜单逻辑，删除死代码 `feishu.ts`，引入 ChannelRegistry 统一事件分发
