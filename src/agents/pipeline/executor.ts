import type { AgentManager } from '../manager';
import type { RuntimeRegistry } from '../runtime/registry';
import { ToolRegistry } from '../../core/registry';
import type { StreamChunk } from '../types';
import type { RuntimeAdapter } from '../runtime/types';
import { ToolLoop } from './tool-loop';

/**
 * PipelineEngine — orchestrates agent execution through the runtime layer.
 *
 * Steps:
 *   1. Resolve agent configuration
 *   2. Resolve runtime adapter (container config → ContainerRuntime)
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

  private resolveRuntime(agent: { config: { container?: unknown }; runtimeType: string }): RuntimeAdapter {
    // If agent has a container config, use ContainerRuntime regardless of declared runtimeType
    if (agent.config.container) {
      return this.runtimeRegistry.get('container');
    }
    return this.runtimeRegistry.get(agent.runtimeType as 'cli' | 'session' | 'container');
  }

  async *executeStream(
    agentName: string,
    sessionId: string,
    message: string,
    signal?: AbortSignal,
    workingDir?: string,
  ): AsyncGenerator<StreamChunk> {
    const agent = this.agentManager.get(agentName);
    if (!agent) {
      yield { type: 'error', content: `Agent not found: ${agentName}` };
      return;
    }

    const runtime = this.resolveRuntime(agent);

    if (signal?.aborted) return;

    // Initialize runtime with working directory
    await runtime.start(sessionId, agent, workingDir);

    if (signal?.aborted) {
      await runtime.cancel(sessionId);
      await runtime.cleanup(sessionId);
      return;
    }

    try {
      // Send user message
      await runtime.send(sessionId, message);

      if (signal?.aborted) {
        await runtime.cancel(sessionId);
        return;
      }

      // Run tool loop (handles multi-round tool calling)
      const toolLoop = new ToolLoop(
        runtime,
        sessionId,
        this.toolRegistry,
        this.options.maxToolRounds ?? 10,
        signal,
      );

      for await (const chunk of toolLoop.run()) {
        if (signal?.aborted) break;
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
    message: string,
    workingDir?: string,
  ): Promise<{ content: string; error?: string }> {
    const chunks: string[] = [];
    let error: string | undefined;

    for await (const chunk of this.executeStream(agentName, sessionId, message, undefined, workingDir)) {
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
