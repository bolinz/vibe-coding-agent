import type { UnifiedMessage, Session } from './types';
import { SessionManager } from './session';
import type { ToolRegistry } from './registry';
import { EventBus } from './event';
import type { AgentManager } from '../agents/manager';
import { PipelineEngine } from '../agents/pipeline/executor';

export class Router {
  constructor(
    private sessionManager: SessionManager,
    private agentManager: AgentManager,
    private eventBus: EventBus,
    private toolRegistry: ToolRegistry,
    private pipeline: PipelineEngine,
    private defaultAgent: string = 'echo'
  ) {}

  getAvailableAgents(): Array<{ name: string; description: string }> {
    return this.agentManager.list().map((agent) => ({
      name: agent.name,
      description: agent.description,
    }));
  }

  getDefaultAgent(): string {
    return this.defaultAgent;
  }

  async route(message: UnifiedMessage): Promise<void> {
    try {
      // 1. Get or create session
      let session = await this.sessionManager.get(message.sessionId);

      if (!session) {
        session = await this.sessionManager.getByUserId(message.userId);
      }

      if (!session) {
        session = await this.sessionManager.create(
          message.userId,
          this.defaultAgent,
          { workingDir: '/projects/sandbox' },
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
      const responseChunks: string[] = [];
      let responseError: string | undefined;

      for await (const chunk of this.pipeline.executeStream(
        agentName,
        session.id,
        message.content
      )) {
        if (chunk.type === 'text') {
          responseChunks.push(chunk.content);
        } else if (chunk.type === 'error') {
          responseError = chunk.content;
        } else if (chunk.type === 'done') {
          break;
        }
        // tool_call and tool_result are handled internally by ToolLoop;
        // they don't surface to the user-facing response.
      }

      const responseContent = responseChunks.join('');

      // 4. Add response to session
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

      // 5. Broadcast response event to all channels for this session
      await this.eventBus.broadcastToChannel(session, responseContent);

      // 6. Publish error if any
      if (responseError) {
        this.eventBus.publish({
          type: 'agent.error',
          sessionId: session.id,
          data: { error: responseError },
          timestamp: new Date(),
        });
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
