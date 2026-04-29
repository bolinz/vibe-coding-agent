# Channel 架构重构 TODO

## 目标
解决代码重复、硬编码依赖、封闭类型三大问题，使 Channel 架构可扩展、消息类型通用。

---

### 现存问题

| # | 问题 | 具体表现 |
|---|------|---------|
| 1 | **400 行重复代码** | `sidecar-feishu.ts` 与 `feishu.ts` 共享卡片构建、状态机、命令处理 |
| 2 | **600 行死代码** | `feishu.ts` + `@larksuiteoapi/node-sdk` — Sidecar 默认启用，直连模式永不运行 |
| 3 | **封闭类型** | `ChannelType = 'feishu' \| 'websocket' \| 'ssh'` — 新增 Channel 必须改核心类型 |
| 4 | **硬编码事件派发** | `index.ts` 中 `wsChannel.send()` + `feishuChannel.send()` — 新增 Channel 必须改入口 |
| 5 | **硬编码 shutdown** | `index.ts` 三个 `.disconnect()` — 同上 |
| 6 | **消息只有纯文本** | `UnifiedMessage.content: string` — 图片/卡片/文件等无法表达 |
| 7 | **能力不透明** | 无法查询 Channel 支持什么（文本/卡片/图片） |
| 8 | **构造方式不统一** | 每个 Channel 构造函数签名不同，无法统一管理 |

### 目标架构

```
src/channels/
├── base.ts                   # BaseChannel (微调)
├── types.ts                  # ★ NEW: 所有 Channel/Message 类型
├── channel-manager.ts        # ★ NEW: 统一管理 Factory + 生命周期 + 广播
│
├── feishu/
│   ├── sidecar-channel.ts    # ★ NEW: 精简版 SidecarFeishuChannel (~200 行)
│   ├── card-builder.ts       # ★ NEW: 卡片构建 (提取自双方)
│   ├── menu-state.ts         # ★ NEW: 菜单状态机 (提取自双方)
│   ├── binary.ts             # ★ NEW: Sidecar 二进制查找 (提取)
│   └── factory.ts            # ★ NEW: FeishuChannelFactory
│
├── websocket/
│   ├── channel.ts            # ★ NEW: WebSocketChannel
│   └── factory.ts            # ★ NEW: WebSocketChannelFactory
│
├── ssh/
│   ├── channel.ts            # ★ NEW: SSHChannel
│   └── factory.ts            # ★ NEW: SSHChannelFactory
│
├── feishu.ts                 # DELETE
├── sidecar-feishu.ts         # DELETE
├── websocket.ts              # DELETE
├── ssh.ts                    # DELETE
├── feishu-register.ts        # KEEP (原地)
└── base.ts (old)             # DELETE (被新 base.ts 替代)
```

---

## 执行阶段

### Phase 1: 新建类型定义 + 基础设施
- [x] `src/channels/types.ts` — Channel 接口 + 消息类型 + Factory 类型
- [x] `src/core/channel-manager.ts` — ChannelManager

### Phase 2: 提取 Feishu 共享逻辑
- [x] `src/channels/feishu/binary.ts` — findSidecarBinary
- [x] `src/channels/feishu/card-builder.ts` — 4 个卡片构建方法
- [x] `src/channels/feishu/menu-state.ts` — 状态机 + 命令处理

### Phase 3: 按新架构重写 Channel
- [x] `src/channels/feishu/sidecar-channel.ts` — 精简版 (~200 行, 原 591)
- [x] `src/channels/feishu/factory.ts` — FeishuChannelFactory
- [x] `src/channels/websocket/channel.ts` — WebSocketChannel
- [x] `src/channels/websocket/factory.ts` — WebSocketChannelFactory
- [x] `src/channels/ssh/channel.ts` — SSHChannel
- [x] `src/channels/ssh/factory.ts` — SSHChannelFactory

### Phase 4: 集成
- [x] `src/index.ts` — 接入 ChannelManager
- [x] `src/web/server.ts` — 接入 ChannelManager

### Phase 5: 删除旧文件 + 清理
- [x] 删除 `src/channels/feishu.ts` (-606 行死代码)
- [x] 删除 `src/channels/sidecar-feishu.ts` (-591 行, 被拆分替代)
- [x] 删除 `src/channels/websocket.ts` (-105 行)
- [x] 删除 `src/channels/ssh.ts` (-61 行)
- [x] 删除旧的 `src/channels/base.ts` (-34 行)
- [x] 删除 `package.json` 中 `@larksuiteoapi/node-sdk` 和 `ws` / `@types/ws`
- [x] 更新测试文件 import 路径

### Phase 6: 验证
- [x] `tsc --noEmit` — 0 错误
- [x] `bun test` — 64 pass / 0 fail
- [x] `bun run build` — 168 modules, 0.55 MB
- [x] 同步到远程服务器验证 Feishu 连接

### Phase 7: 文档
- [x] `docs/00-architecture.md` — 更新 Channel 章节
- [x] `docs/TODO-CHANNEL-REFACTOR.md` — 标记完成

---

## 最终成果

| 指标 | 改造前 | 改造后 | 变化 |
|------|--------|--------|------|
| 文件数 | 8 个 channels 文件 | 13 个 channels 文件 | +5 组织更清晰 |
| 总行数 | ~1,500 | ~1,100 | **-400 行** (消除重复) |
| 死代码 | `feishu.ts` 606 行 + SDK 依赖 | 已删除 | -606 行 |
| Channel type | 封闭 union | 开放 string | 新增 Channel 无需改核心类型 |
| 消息类型 | `content: string` | `text + attachments + card + metadata` | 通用结构化消息 |
| 能力声明 | 无 | `ChannelCapabilities` | 按能力分发 |
| 新增 Channel | 改 3 处核心代码 | 1 文件 + 1 factory | 零核心改动 |
| 事件派发 | 硬编码 in index.ts | ChannelRegistry.broadcast() | 自动广播

---

## 关键设计决策

1. **Channel.type = `string`** — 不再是封闭 union，新增 Channel 无需改核心类型
2. **IncomingMessage.text + attachments** — 纯文本给 Agent；富内容可选携带
3. **OutgoingMessage.text + card + attachments** — 所有 Channel 保证 text 倒退兼容
4. **ChannelCapabilities** — 每个 Channel 声明能力，广播时按能力分发
5. **ChannelFactory** — 统一创建方式，支持配置驱动
6. **ChannelManager** — 统一生命周期 + 能力感知广播
7. **`@larksuiteoapi/node-sdk` 移除** — Sidecar 已完全替代直连 SDK
