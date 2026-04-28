import { describe, expect, test } from 'bun:test';
import { PipelineEngine } from './executor';
import { ToolLoop } from './tool-loop';
import { AgentManager } from '../manager';
import { RuntimeRegistry } from '../runtime/registry';
import { CLIRuntime } from '../runtime/cli';
import { ToolRegistry } from '../../core/registry';
import type { StreamChunk } from '../types';

describe('PipelineEngine', () => {
  test('should return error for non-existent agent', async () => {
    const agentManager = new AgentManager();
    const runtimeRegistry = new RuntimeRegistry();
    runtimeRegistry.register('cli', new CLIRuntime());
    const toolRegistry = new ToolRegistry();

    const pipeline = new PipelineEngine(agentManager, runtimeRegistry, toolRegistry);

    const chunks: StreamChunk[] = [];
    for await (const chunk of pipeline.executeStream('non-existent', 'sess-1', 'hello')) {
      chunks.push(chunk);
    }

    const errorChunk = chunks.find((c) => c.type === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk!.content).toContain('Agent not found');
  });

  test('should execute echo agent and return text', async () => {
    const agentManager = new AgentManager();
    const runtimeRegistry = new RuntimeRegistry();
    runtimeRegistry.register('cli', new CLIRuntime());
    const toolRegistry = new ToolRegistry();

    agentManager.register({
      name: 'echo',
      description: 'Echo',
      runtimeType: 'cli',
      config: { command: 'echo', args: ['Echo:'] },
      capabilities: { streaming: false, multiTurn: false },
    });

    const pipeline = new PipelineEngine(agentManager, runtimeRegistry, toolRegistry);
    const result = await pipeline.execute('echo', 'sess-2', 'World');

    expect(result.content.trim()).toBe('Echo: World');
    expect(result.error).toBeUndefined();
  });
});

describe('ToolLoop', () => {
  test('should pass through text chunks without tool calls', async () => {
    const mockRuntime = {
      type: 'cli' as const,
      async *read() {
        yield { type: 'text' as const, content: 'Hello' };
        yield { type: 'done' as const };
      },
      async send() {},
      async start() {},
      async stop() {},
      isRunning() { return true; },
      async cancel() {},
      async cleanup() {},
    };

    const toolRegistry = new ToolRegistry();
    const loop = new ToolLoop(mockRuntime, 'sess-1', toolRegistry, 10);

    const chunks: StreamChunk[] = [];
    for await (const chunk of loop.run()) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({ type: 'text', content: 'Hello' });
    expect(chunks).toContainEqual({ type: 'done' });
  });
});
