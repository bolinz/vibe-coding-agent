# Agent 架构重构 TODO

## 目标
将 Agent 从"自定义执行类"重构为"纯配置管理 + 通用 Runtime 执行"架构。

---

## 阶段清单

### Stage 1: 新类型定义 ✅
- [x] 创建 `src/agents/types.ts` — Agent 配置、ExecutionContext、StreamChunk
- [x] 创建 `src/agents/runtime/types.ts` — RuntimeAdapter 接口
- [x] 修改 `src/core/types.ts` — 精简旧 Agent 类型，Session.agentType 改为 string

### Stage 2: Runtime 层实现 ✅
- [x] 创建 `src/agents/runtime/registry.ts` — RuntimeRegistry
- [x] 创建 `src/agents/runtime/cli.ts` — CLIRuntime（claude/codex/cline/hermes）
- [x] 创建 `src/agents/runtime/session.ts` — SessionRuntime（aider + tmux）
- [x] CLIRuntime: spawn 进程管理、流式读取、cancel/kill
- [x] SessionRuntime: tmux 生命周期管理、防注入 send-keys、cleanup

### Stage 3: Manager 与 Pipeline ✅
- [x] 创建 `src/agents/manager.ts` — AgentManager（register/get/list/remove）
- [x] 创建 `src/agents/pipeline/executor.ts` — PipelineEngine（编排执行流程）
- [x] 创建 `src/agents/pipeline/tool-loop.ts` — ToolExecutor（多轮 tool calling 循环）
- [x] Pipeline 中间件钩子 (beforeExecute / afterExecute / onError)

### Stage 4: 改造 Router ✅
- [x] 修改 `src/core/router.ts`
  - 注入 PipelineEngine 替代 AgentRegistry
  - route() 调用 pipeline.executeStream()
  - 移除 inline tool execution（交给 ToolLoop）
  - 更新 getAvailableAgents()
- [x] 修改 `src/core/registry.ts`
  - 删除 AgentRegistry 类
  - 删除 getAgentRegistry() singleton
  - 保留 ToolRegistry

### Stage 5: 清理旧 Agent ✅
- [x] 删除 `src/agents/base.ts`
- [x] 删除 `src/agents/aider.ts`
- [x] 删除 `src/agents/claude.ts`
- [x] 删除 `src/agents/hermes.ts`
- [x] 删除 `src/agents/echo.ts`

### Stage 6: 更新入口文件 ✅
- [x] 修改 `src/index.ts`
  - 导入新架构模块
  - 注册 Runtime (CLIRuntime, SessionRuntime)
  - 注册 Agent 配置（声明式）
  - 初始化 PipelineEngine
  - 移除所有旧 Agent class 导入和实例化

### Stage 7: 更新测试 ✅
- [x] 修改 `src/core/registry.test.ts` — 移除 AgentRegistry 测试
- [x] 修改 `src/core/types.test.ts` — 更新 AgentType 断言
- [x] 修改 `src/core/session.test.ts` — agentType 改为 string
- [x] 修改 `test/integration/sidecar-channel.test.ts` — 适配新架构
- [x] 新建 `src/agents/manager.test.ts` — AgentManager 单元测试

### Stage 8: 验证 ✅
- [x] 运行 `bun test` 全量通过 (64 pass / 0 fail)
- [x] 运行 `bun run typecheck` 无类型错误
- [x] 新增测试覆盖：RuntimeRegistry, CLIRuntime, PipelineEngine, ToolLoop, AgentManager
- [x] 手动启动服务验证基本流程
- [x] 部署到远程服务器 (Fedora Silverblue)
- [x] Hermes Agent 端到端调用成功
- [x] SSE idleTimeout 修复 (10s → 255s)
- [x] 文档更新 + 敏感内容清理 + .gitignore 创建

---

## 关键决策记录

1. **Agent = 纯配置声明**，不再有自定义 execute() 方法
2. **Runtime = 2 种通用后端**: `cli` (一次性进程) / `session` (tmux 持久会话)
3. **Pipeline = 统一编排层**，接管 tool calling 循环和流式处理
4. **Session.agentType** 从 union type 改为 `string`，支持任意外部 CLI 名称
5. **Tool calling** 从 Router 的 1 轮硬编码 → Pipeline 的多轮循环
