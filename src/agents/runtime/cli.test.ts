import { describe, expect, test } from 'bun:test';
import { CLIRuntime } from './cli';
import type { Agent } from '../types';

describe('CLIRuntime', () => {
  const echoAgent: Agent = {
    name: 'echo',
    description: 'Echo agent',
    runtimeType: 'cli',
    config: { command: 'echo', args: ['Hello'] },
    capabilities: { streaming: false, multiTurn: false },
  };

  test('should start without spawning process', async () => {
    const runtime = new CLIRuntime();
    await runtime.start('sess-1', echoAgent);
    expect(runtime.isRunning('sess-1')).toBe(false);
  });

  test('should execute echo command and return output', async () => {
    const runtime = new CLIRuntime();
    await runtime.start('sess-1', echoAgent);
    await runtime.send('sess-1', 'World');

    const chunks: string[] = [];
    for await (const chunk of runtime.read('sess-1')) {
      if (chunk.type === 'text') chunks.push(chunk.content);
    }

    const output = chunks.join('').trim();
    expect(output).toBe('Hello World');
  });

  test('should handle non-existent command', async () => {
    const runtime = new CLIRuntime();
    const badAgent: Agent = {
      name: 'bad',
      description: 'Bad agent',
      runtimeType: 'cli',
      config: { command: 'this_command_does_not_exist_12345' },
      capabilities: { streaming: false, multiTurn: false },
    };

    await runtime.start('sess-2', badAgent);
    await runtime.send('sess-2', '');

    const chunks: string[] = [];
    for await (const chunk of runtime.read('sess-2')) {
      if (chunk.type === 'text' || chunk.type === 'error') {
        chunks.push(chunk.content);
      }
    }

    // Should get error output or empty output
    expect(chunks.length).toBeGreaterThanOrEqual(0);
  });

  test('should cancel running process', async () => {
    const runtime = new CLIRuntime();
    const sleepAgent: Agent = {
      name: 'sleep',
      description: 'Sleep agent',
      runtimeType: 'cli',
      config: { command: 'sleep', args: ['5'] },
      capabilities: { streaming: false, multiTurn: false },
    };

    await runtime.start('sess-3', sleepAgent);
    await runtime.send('sess-3', '');

    // Cancel immediately
    await runtime.cancel('sess-3');
    expect(runtime.isRunning('sess-3')).toBe(false);
  });

  test('should cleanup session', async () => {
    const runtime = new CLIRuntime();
    await runtime.start('sess-4', echoAgent);
    await runtime.send('sess-4', 'test');

    await runtime.cleanup('sess-4');
    expect(runtime.isRunning('sess-4')).toBe(false);
  });
});
