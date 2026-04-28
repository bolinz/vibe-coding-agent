import type { AgentManager } from '../manager';
import type { RuntimeRegistry } from '../runtime/registry';
import { ToolRegistry } from '../../core/registry';
import type { StreamChunk } from '../types';
import { ToolLoop } from './tool-loop';

/**
 * PipelineEngine — orchestrates agent execution through the runtime layer.
 *
 * Steps:
 *   1. Resolve agent configuration
 *   2. Resolve runtime adapter
 *   3. runtime.start() — initialize runtime instance
 *   4. runtime.send() — dispatch user message
 *   5. ToolLoop.run() — read response, handle tool calling rounds
 *   6. runtime.cleanup() — optional, for one-shot CLI runtimes
 */
export class PipelineEngine {
  constructor(
    private agentManager: AgentManager,
    private runtimeRegistry: RuntimeRegistry,
    private toolRegistry: ToolRegistry,
    private options: { maxToolRounds?: number } = {}
  ) {}

  async *executeStream(
    agentName: string,
    sessionId: string,
    message: string
  ): AsyncGenerator<StreamChunk> {
    const agent = this.agentManager.get(agentName);
    if (!agent) {
      yield { type: 'error', content: `Agent not found: ${agentName}` };
      return;
    }

    const runtime = this.runtimeRegistry.get(agent.runtimeType);

    // Initialize runtime
    await runtime.start(sessionId, agent);

    try {
      // Send user message
      await runtime.send(sessionId, message);

      // Run tool loop (handles multi-round tool calling)
      const toolLoop = new ToolLoop(
        runtime,
        sessionId,
        this.toolRegistry,
        this.options.maxToolRounds ?? 10
      );

      for await (const chunk of toolLoop.run()) {
        yield chunk;
      }
    } finally {
      // For CLI runtimes, cleanup kills the process.
      // For session runtimes, cleanup is a no-op (session persists).
      await runtime.cleanup(sessionId);
    }
  }

  /**
   * Non-streaming convenience wrapper.
   */
  async execute(
    agentName: string,
    sessionId: string,
    message: string
  ): Promise<{ content: string; error?: string }> {
    const chunks: string[] = [];
    let error: string | undefined;

    for await (const chunk of this.executeStream(agentName, sessionId, message)) {
      if (chunk.type === 'text') {
        chunks.push(chunk.content);
      } else if (chunk.type === 'error') {
        error = chunk.content;
      } else if (chunk.type === 'done') {
        break;
      }
    }

    return {
      content: chunks.join(''),
      error,
    };
  }
}
