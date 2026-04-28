import type { StreamChunk } from '../types';
import type { RuntimeAdapter } from '../runtime/types';
import { ToolRegistry } from '../../core/registry';

/**
 * ToolLoop — handles multi-round tool calling between agent and tools.
 *
 * Flow:
 *   1. Read chunks from runtime
 *   2. If tool_call chunk → execute tool → send result back → read again
 *   3. Repeat up to maxRounds
 *   4. Yield all non-tool chunks (text, error, done) to caller
 */
export class ToolLoop {
  constructor(
    private runtime: RuntimeAdapter,
    private sessionId: string,
    private toolRegistry: ToolRegistry,
    private maxRounds = 10
  ) {}

  async *run(): AsyncGenerator<StreamChunk> {
    for (let round = 0; round < this.maxRounds; round++) {
      let hasToolCall = false;

      for await (const chunk of this.runtime.read(this.sessionId)) {
        if (chunk.type === 'tool_call') {
          hasToolCall = true;
          yield chunk;

          // Execute the tool
          let result: unknown;
          let error: string | undefined;
          try {
            result = await this.toolRegistry.execute(chunk.toolName, chunk.toolArgs);
          } catch (err) {
            error = err instanceof Error ? err.message : 'Unknown error';
            result = { error };
          }

          yield {
            type: 'tool_result',
            toolCallId: chunk.toolCallId,
            result,
          };

          // Send result back to the agent runtime
          const resultMessage = error
            ? `[TOOL_RESULT] ${chunk.toolName}: ERROR: ${error}`
            : `[TOOL_RESULT] ${chunk.toolName}: ${JSON.stringify(result)}`;

          await this.runtime.send(this.sessionId, resultMessage);
        } else if (chunk.type === 'done' || chunk.type === 'error') {
          yield chunk;
          return;
        } else {
          yield chunk;
        }
      }

      if (!hasToolCall) {
        // No tool calls this round; agent has returned final response
        return;
      }

      // There was a tool call; the result was sent back above.
      // Loop again to read the agent's follow-up response.
    }

    yield {
      type: 'error',
      content: `Tool calling exceeded maximum rounds (${this.maxRounds})`,
    };
  }
}
