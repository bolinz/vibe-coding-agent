import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { ContainerRuntime } from '../../src/agents/runtime/container';
import { PipelineEngine } from '../../src/agents/pipeline/executor';
import { AgentManager } from '../../src/agents/manager';
import { RuntimeRegistry } from '../../src/agents/runtime/registry';
import { ToolRegistry } from '../../src/core/registry';
import type { Agent, ContainerConfig, StreamChunk } from '../../src/agents/types';

async function hasContainerDaemon(): Promise<{ available: boolean; cmd: string }> {
  const candidates = ['docker', 'podman'];
  for (const cmd of candidates) {
    try {
      const proc = Bun.spawn({ cmd: [cmd, 'info'], stdout: 'pipe', stderr: 'pipe' });
      await proc.exited;
      if (proc.exitCode === 0) {
        return { available: true, cmd };
      }
    } catch {}
  }
  return { available: false, cmd: '' };
}

const { available: hasContainer, cmd: containerCmd } = await hasContainerDaemon();

function withCmd(agent: Agent): Agent {
  if (!containerCmd || containerCmd === 'docker') return agent;
  return {
    ...agent,
    config: {
      ...agent.config,
      container: { ...agent.config.container!, cmd: containerCmd },
    },
  };
}

const containerAgent: Agent = {
  name: 'container-echo',
  description: 'Echo in container',
  runtimeType: 'cli',
  config: {
    command: 'echo',
    args: ['ContainerEcho: {message}'],
    container: { image: 'alpine:latest' },
  },
  capabilities: { streaming: false, multiTurn: false },
};

describe.if(hasContainer)('Container E2E', () => {
  const rt = new ContainerRuntime();
  let tmpDir: string;

  beforeAll(() => {
    const baseDir = join(homedir(), '.cache', 'vibe-container-test');
    if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
    tmpDir = mkdtempSync(join(baseDir, 'e2e-'));
    writeFileSync(join(tmpDir, 'test.txt'), 'container-volume-content');
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  test('alpine echo container outputs message', async () => {
    await rt.start('e2e-1', withCmd(containerAgent));
    await rt.send('e2e-1', 'hello world');

    const chunks: StreamChunk[] = [];
    for await (const c of rt.read('e2e-1')) chunks.push(c);

    const texts = chunks.filter(c => c.type === 'text').map(c => c.content).join('').trim();
    expect(texts).toContain('hello world');
  });

  test('volume mount allows reading host files', async () => {
    const catAgent = withCmd({
      name: 'container-cat',
      description: 'cat in container',
      runtimeType: 'cli',
      config: {
        command: 'cat',
        args: ['/workspace/test.txt'],
        container: { image: 'alpine:latest' },
      },
      capabilities: { streaming: false, multiTurn: false },
    } as Agent);
    expect(existsSync(join(tmpDir, 'test.txt'))).toBe(true);
    await rt.start('e2e-2', catAgent, tmpDir);
    await rt.send('e2e-2', '');

    const chunks: StreamChunk[] = [];
    for await (const c of rt.read('e2e-2')) chunks.push(c);

    const texts = chunks.filter(c => c.type === 'text').map(c => c.content).join('').trim();
    expect(texts).toContain('container-volume-content');
  });

  test('non-streaming read returns complete output with done', async () => {
    await rt.start('e2e-3', withCmd(containerAgent));
    await rt.send('e2e-3', 'test-complete');

    const chunks: StreamChunk[] = [];
    for await (const c of rt.read('e2e-3')) chunks.push(c);
    expect(chunks.some(c => c.type === 'done')).toBe(true);
  });

  test('invalid image yields error chunk', { timeout: 15000 }, async () => {
    const badAgent = withCmd({
      name: 'bad-image',
      description: 'nonexistent image',
      runtimeType: 'cli',
      config: {
        command: 'echo',
        args: ['x'],
        container: { image: 'this-image-does-not-exist-123456789' },
      },
      capabilities: { streaming: false, multiTurn: false },
    } as Agent);
    await rt.start('e2e-4', badAgent);
    await rt.send('e2e-4', '');

    const chunks: StreamChunk[] = [];
    const timer = setTimeout(() => { rt.cancel('e2e-4'); }, 10000);
    for await (const c of rt.read('e2e-4')) chunks.push(c);
    clearTimeout(timer);
    expect(chunks.length).toBeGreaterThan(0);
  });

  test('cancel terminates container process', async () => {
    const sleepAgent = withCmd({
      name: 'container-sleep',
      description: 'long running',
      runtimeType: 'cli',
      config: {
        command: 'sleep',
        args: ['30'],
        container: { image: 'alpine:latest' },
      },
      capabilities: { streaming: false, multiTurn: false },
    } as Agent);
    await rt.start('e2e-5', sleepAgent);
    await rt.send('e2e-5', '');
    await rt.cancel('e2e-5');
    expect(rt.isRunning('e2e-5')).toBe(false);
  });
});

describe.if(hasContainer)('Pipeline + Container integration', () => {
  const agentManager = new AgentManager();
  const runtimeRegistry = new RuntimeRegistry();
  const toolRegistry = new ToolRegistry();
  let pipeline: PipelineEngine;

  beforeAll(() => {
    runtimeRegistry.register('cli', new ContainerRuntime());
    runtimeRegistry.register('container', new ContainerRuntime());
    agentManager.register(withCmd(containerAgent));
    pipeline = new PipelineEngine(agentManager, runtimeRegistry, toolRegistry);
  });

  test('Pipeline resolves container runtime for agent with container config', async () => {
    const result = await pipeline.execute('container-echo', 'pipeline-1', 'PipelineTest');
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('PipelineTest');
  });
});
