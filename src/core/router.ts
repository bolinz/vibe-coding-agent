import type { UnifiedMessage, Session } from './types';
import { SessionManager } from './session';
import type { ToolRegistry } from './registry';
import { EventBus } from './event';
import type { AgentManager } from '../agents/manager';
import { PipelineEngine } from '../agents/pipeline/executor';
import { ConfigManager } from './config';
import { existsSync, mkdirSync } from 'fs';

function resolveWorkingDir(dir: string | undefined, home: string): string {
  const candidate = dir || '/projects/sandbox';
  try {
    if (existsSync(candidate)) return candidate;
  } catch {}
  const fallback = `${home}/.cache/vibe-agent/workdir`;
  try { mkdirSync(fallback, { recursive: true }); } catch {}
  return fallback;
}

const CHANNEL_NAMES: Record<string, string> = {
  feishu: '飞书',
  websocket: 'Web UI',
  ssh: 'SSH',
  webhook: 'Webhook',
  github: 'GitHub',
  mcp: 'MCP',
};

function buildInitPrompt(channel: string, agentName: string, runtimeLabel: string): string {
  return [
    '你是一个 AI 编程助手。用中文回复，简洁专业。',
    '',
    '[上下文]',
    `调用平台: Vibe Coding Agent`,
    `当前渠道: ${channel} (${CHANNEL_NAMES[channel] || channel})`,
    `当前 Agent: ${agentName} (${runtimeLabel})`,
    '消息来源: 用户',
    '',
    '所有 role=system 的消息由框架自动注入，不是用户输入。',
    '',
    '[消息格式]',
    '支持以下结构化回复类型：',
    '',
    '1. 纯文本 — 直接输出',
    '',
    '2. [CARD] — 结构化卡片',
    '[CARD]',
    '{ "template": "blue", "title": "标题", "content": "内容" }',
    '[/CARD]',
    'template 可选: blue / green / red / grey',
    '',
    '3. [CODE] — 代码块',
    '[CODE lang=python]',
    'print("hello")',
    '[/CODE]',
    '',
    '4.  ``` 语言名 — Markdown 代码块',
    '',
    '[欢迎]',
    '新对话开始时，发送欢迎消息包含纯文本问候、[CARD] 卡片、[CODE] 示例。',
  ].join('\n');
}

export class Router {
  private runningPipelines = new Map<string, AbortController>();

  constructor(
    private sessionManager: SessionManager,
    private agentManager: AgentManager,
    private eventBus: EventBus,
    private toolRegistry: ToolRegistry,
    private pipeline: PipelineEngine,
    private defaultAgent: string = 'echo'
  ) {}

  getAvailableAgents(): Array<{ name: string; description: string; runtimeType: string; hasContainer: boolean; streaming: boolean; multiTurn: boolean }> {
    return this.agentManager.list().map((agent) => ({
      name: agent.name,
      description: agent.description,
      runtimeType: agent.runtimeType,
      hasContainer: !!agent.config.container,
      streaming: agent.capabilities.streaming,
      multiTurn: agent.capabilities.multiTurn,
    }));
  }

  registerAgent(agent: import('../agents/types').Agent): void {
    this.agentManager.register(agent);
  }

  unregisterAgent(name: string): boolean {
    return this.agentManager.remove(name);
  }

  getDefaultAgent(): string {
    // Check hot-reloaded env var (set by config API's reload endpoint)
    const envAgent = process.env.DEFAULT_AGENT;
    if (envAgent && this.agentManager.has(envAgent)) return envAgent;
    // Check DB config
    try {
      const cm = new ConfigManager();
      const dbAgent = cm.get('default_agent');
      if (dbAgent && this.agentManager.has(dbAgent)) return dbAgent;
    } catch {}
    // Fallback to constructor default
    return this.defaultAgent;
  }

  setDefaultAgent(name: string): boolean {
    if (!this.agentManager.has(name)) return false;
    try {
      const cm = new ConfigManager();
      cm.set('default_agent', name);
      process.env.DEFAULT_AGENT = name;
      return true;
    } catch { return false; }
  }

  cancel(sessionId: string): void {
    const controller = this.runningPipelines.get(sessionId);
    if (controller) {
      controller.abort();
      this.runningPipelines.delete(sessionId);
    }
  }

  isRunning(sessionId: string): boolean {
    return this.runningPipelines.has(sessionId);
  }

  async route(message: UnifiedMessage): Promise<void> {
    let timedOut = false;
    let timeoutId: Timer | undefined;
    try {
      // 1. Get or create session
      let session = await this.sessionManager.get(message.sessionId);

      if (!session) {
        session = await this.sessionManager.getByUserId(message.userId);
      }

      if (!session) {
        const cm = new ConfigManager();
        const rawDir = cm.get('working_dir');
        const workingDir = resolveWorkingDir(rawDir, process.env.HOME || '/tmp');
        session = await this.sessionManager.create(
          message.userId,
          this.getDefaultAgent(),
          { workingDir },
          message.sessionId
        );

        this.eventBus.publish({
          type: 'session.created',
          sessionId: session.id,
          data: { userId: message.userId },
          timestamp: new Date(),
        });
      }

      // Agent fallback: if previous run failed and agent isn't echo, switch to echo
      if (session.context?.shouldFallback && session.agentType !== 'echo') {
        console.log(`[Router] Fallback: switching session ${session.id} from ${session.agentType} to echo`);
        session.agentType = 'echo';
        await this.sessionManager.updateContext(session.id, { shouldFallback: '' });
      }

      // Inject system prompt on first use for interactive channels
      if ((message.channel === 'feishu' || message.channel === 'websocket') && !session.context?.promptInjected) {
        const agent = this.agentManager.get(session.agentType);
        const runtimeLabel = agent?.config.container ? '容器' : 'CLI';
        const initPrompt = buildInitPrompt(message.channel, session.agentType, runtimeLabel);
        await this.sessionManager.addMessage(session.id, {
          channel: message.channel,
          channelId: message.channelId,
          sessionId: session.id,
          userId: 'system',
          role: 'system',
          content: initPrompt,
          timestamp: new Date(),
        });
        await this.sessionManager.updateContext(session.id, { promptInjected: 'true' });
      }

      // 2. Add message to session
      await this.sessionManager.addMessage(session.id, message);

      this.eventBus.publish({
        type: 'agent.thinking',
        sessionId: session.id,
        data: { content: message.content },
        timestamp: new Date(),
      });

      // 3. Execute via PipelineEngine (handles streaming + tool loops)
      const agentName = session.agentType;
      const cm = new ConfigManager();
      const rawDir = cm.get('working_dir');
      const configWorkDir = resolveWorkingDir(rawDir, process.env.HOME || '/tmp');
      const workingDir = resolveWorkingDir(session.context?.workingDir, process.env.HOME || '/tmp') || configWorkDir;
      const responseChunks: string[] = [];
      let responseCard: Record<string, unknown> | undefined;
      const responseAttachments: Array<{ type: string; data: unknown; language?: string }> = [];
      let responseError: string | undefined;

      // Build channel info for agent
      const channelCapabilities: string[] = [];
      if (message.channel === 'feishu') channelCapabilities.push('cards', 'code', 'table');
      if (message.channel === 'websocket') channelCapabilities.push('markdown', 'code');
      const channelInfo = channelCapabilities.length > 0
        ? { type: message.channel, supports: channelCapabilities }
        : undefined;

      const abortController = new AbortController();
      this.runningPipelines.set(session.id, abortController);

      // Pipeline timeout: 60 seconds
      timeoutId = setTimeout(() => {
        timedOut = true;
        this.eventBus.publish({
          type: 'agent.error',
          sessionId: session.id,
          data: { error: `Agent ${session.agentType} 响应超时（60 秒），已自动取消` },
          timestamp: new Date(),
        });
        abortController.abort();
      }, 120_000);

      try {
        for await (const chunk of this.pipeline.executeStream(
          agentName,
          session.id,
          message.content,
          abortController.signal,
          workingDir,
          channelInfo,
        )) {
          if (chunk.type === 'text') {
            responseChunks.push(chunk.content);
            this.eventBus.publish({
              type: 'agent.stream_chunk',
              sessionId: session.id,
              data: { content: chunk.content },
              timestamp: new Date(),
            });
          } else if (chunk.type === 'card') {
            responseCard = chunk.card;
          } else if (chunk.type === 'rich') {
            responseAttachments.push({ type: chunk.format, data: chunk.content, language: chunk.language });
          } else if (chunk.type === 'error') {
            responseError = chunk.content;
          } else if (chunk.type === 'tool_call') {
            this.eventBus.publish({
              type: 'agent.tool_executing',
              sessionId: session.id,
              data: { toolName: chunk.toolName, toolArgs: chunk.toolArgs },
              timestamp: new Date(),
            });
          } else if (chunk.type === 'done') {
            break;
          }
        }
      } finally {
        clearTimeout(timeoutId);
        this.runningPipelines.delete(session.id);
      }

      // If aborted due to timeout, the error was already published; just return
      if (timedOut) return;

      const responseContent = responseChunks.join('');

      // If aborted by cancel, don't save to session or broadcast
      if (abortController.signal.aborted) return;

      // 4a. Publish error first (if any), so channels can handle it before empty response
      if (responseError) {
        this.eventBus.publish({
          type: 'agent.error',
          sessionId: session.id,
          data: { error: responseError },
          timestamp: new Date(),
        });
      }

      // 4b. Add response to session (even if empty)
      const assistantMessage: UnifiedMessage = {
        channel: message.channel,
        channelId: message.channelId,
        sessionId: session.id,
        userId: 'assistant',
        role: 'assistant',
        content: responseContent,
        timestamp: new Date(),
      };

      await this.sessionManager.addMessage(session.id, assistantMessage);

      // 5. Broadcast structured response
      if (responseContent || responseCard || responseAttachments.length > 0) {
        await this.eventBus.broadcastToChannel(session, responseContent, responseCard, responseAttachments);
      }

      // 6. Agent fallback: if the current agent failed and isn't echo, auto-switch
      if (responseError && session.agentType !== 'echo') {
        console.log(`[Router] Agent ${session.agentType} failed, switching to echo for session ${session.id}`);
        await this.sessionManager.updateContext(session.id, { shouldFallback: 'true' });
      }
    } catch (error) {
      // Don't publish error for aborted (timeout already did)
      if (timedOut) return;

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.eventBus.publish({
        type: 'agent.error',
        sessionId: message.sessionId,
        data: { error: errorMessage },
        timestamp: new Date(),
      });

      throw error;
    }
  }
}
