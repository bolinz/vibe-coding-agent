import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ContainerRuntime } from '../../src/agents/runtime/container';
import { PipelineEngine } from '../../src/agents/pipeline/executor';
import { AgentManager } from '../../src/agents/manager';
import { RuntimeRegistry } from '../../src/agents/runtime/registry';
import { ToolRegistry } from '../../src/core/registry';
import type { Agent, ContainerConfig, StreamChunk } from '../../src/agents/types';

async function hasDockerDaemon(): Promise<boolean> {
  try {
    const proc = Bun.spawn({ cmd: ['docker', 'info', '--format', '{{.ServerVersion}}'], stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return proc.exitCode === 0 && out.trim().length > 0;
  } catch { return false; }
}

const containerAgent: Agent = {
  name: 'container-echo',
  description: 'Echo in container',
  runtimeType: 'cli',
  config: {
    command: 'echo',
    args: ['ContainerEcho:'],
    container: { image: 'alpine:latest' },
  },
  capabilities: { streaming: false, multiTurn: false },
};

const hasDocker = await hasDockerDaemon();

describe.if(hasDocker)('Container E2E', () => {
  const rt = new ContainerRuntime();
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vibe-container-e2e-'));
    writeFileSync(join(tmpDir, 'test.txt'), 'container-volume-content');
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  test('alpine echo container outputs message', async () => {
    await rt.start('e2e-1', containerAgent);
    await rt.send('e2e-1', 'hello world');

    const chunks: StreamChunk[] = [];
    for await (const c of rt.read('e2e-1')) chunks.push(c);

    const texts = chunks.filter(c => c.type === 'text').map(c => c.content).join('').trim();
    expect(texts).toContain('hello world');
  });

  test('volume mount allows reading host files', async () => {
    const catAgent: Agent = {
      name: 'container-cat',
      description: 'cat in container',
      runtimeType: 'cli',
      config: {
        command: 'cat',
        args: ['/workspace/test.txt'],
        container: { image: 'alpine:latest' },
      },
      capabilities: { streaming: false, multiTurn: false },
    };
    await rt.start('e2e-2', catAgent, tmpDir);
    await rt.send('e2e-2', '');

    const chunks: StreamChunk[] = [];
    for await (const c of rt.read('e2e-2')) chunks.push(c);

    const texts = chunks.filter(c => c.type === 'text').map(c => c.content).join('').trim();
    expect(texts).toContain('container-volume-content');
  });

  test('non-streaming read returns complete output with done', async () => {
    await rt.start('e2e-3', containerAgent);
    await rt.send('e2e-3', 'test-complete');

    const chunks: StreamChunk[] = [];
    for await (const c of rt.read('e2e-3')) chunks.push(c);
    expect(chunks.some(c => c.type === 'done')).toBe(true);
  });

  test('invalid image yields error chunk', async () => {
    const badAgent: Agent = {
      name: 'bad-image',
      description: 'nonexistent image',
      runtimeType: 'cli',
      config: {
        command: 'echo',
        args: ['x'],
        container: { image: 'this-image-does-not-exist-123456' },
      },
      capabilities: { streaming: false, multiTurn: false },
    };
    await rt.start('e2e-4', badAgent);
    await rt.send('e2e-4', '');

    const chunks: StreamChunk[] = [];
    for await (const c of rt.read('e2e-4')) chunks.push(c);
    expect(chunks.some(c => c.type === 'error')).toBe(true);
  });

  test('cancel terminates container process', async () => {
    const sleepAgent: Agent = {
      name: 'container-sleep',
      description: 'long running',
      runtimeType: 'cli',
      config: {
        command: 'sleep',
        args: ['30'],
        container: { image: 'alpine:latest' },
      },
      capabilities: { streaming: false, multiTurn: false },
    };
    await rt.start('e2e-5', sleepAgent);
    await rt.send('e2e-5', '');
    await rt.cancel('e2e-5');
    expect(rt.isRunning('e2e-5')).toBe(false);
  });
});

describe.if(hasDocker)('Pipeline + Container integration', () => {
  const agentManager = new AgentManager();
  const runtimeRegistry = new RuntimeRegistry();
  const toolRegistry = new ToolRegistry();
  let pipeline: PipelineEngine;

  beforeAll(() => {
    runtimeRegistry.register('cli', new ContainerRuntime());
    runtimeRegistry.register('container', new ContainerRuntime());
    agentManager.register(containerAgent);
    pipeline = new PipelineEngine(agentManager, runtimeRegistry, toolRegistry);
  });

  test('Pipeline resolves container runtime for agent with container config', async () => {
    const result = await pipeline.execute('container-echo', 'pipeline-1', 'PipelineTest');
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('PipelineTest');
  });
});
