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
    return this.defaultAgent;
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
          this.defaultAgent,
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
      let responseError: string | undefined;

      const abortController = new AbortController();
      this.runningPipelines.set(session.id, abortController);

      try {
        for await (const chunk of this.pipeline.executeStream(
          agentName,
          session.id,
          message.content,
          abortController.signal,
          workingDir,
        )) {
          if (chunk.type === 'text') {
            responseChunks.push(chunk.content);
            this.eventBus.publish({
              type: 'agent.stream_chunk',
              sessionId: session.id,
              data: { content: chunk.content },
              timestamp: new Date(),
            });
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
        this.runningPipelines.delete(session.id);
      }

      const responseContent = responseChunks.join('');

      // If aborted, don't save to session or broadcast
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

      // 5. Only broadcast response if there's actual content
      if (responseContent) {
        await this.eventBus.broadcastToChannel(session, responseContent);
      }
    } catch (error) {
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
