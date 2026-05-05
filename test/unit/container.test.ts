import { describe, test, expect } from 'bun:test';
import { buildContainerRunArgs, ContainerRuntime } from '../../src/agents/runtime/container';
import type { Agent, ContainerConfig, StreamChunk } from '../../src/agents/types';

const defaultCC: ContainerConfig = { image: 'alpine:latest' };
const defaultAgent: Agent = {
  name: 'test-agent',
  description: 'test',
  runtimeType: 'cli',
  config: { command: 'echo', args: ['hello'] },
  capabilities: { streaming: false, multiTurn: false },
};

describe('buildContainerRunArgs', () => {

  test('basic echo command', () => {
    const args = buildContainerRunArgs('docker', defaultCC, 'echo', ['hello'], '');
    expect(args[0]).toBe('docker');
    expect(args[1]).toBe('run');
    expect(args).toContain('--rm');
    expect(args).toContain('-i');
    expect(args).toContain('-v');
    expect(args).toContain('-w');
    expect(args).toContain('/workspace');
    expect(args).toContain('alpine:latest');
    expect(args).toContain('echo');
    expect(args).toContain('hello');
  });

  test('custom workDir', () => {
    const cc: ContainerConfig = { image: 'node:20-slim', workDir: '/app' };
    const args = buildContainerRunArgs('docker', cc, 'node', ['--version'], '', undefined, '/host/path');
    const wIdx = args.indexOf('-w');
    expect(args[wIdx + 1]).toBe('/app');
    const vIdx = args.indexOf('-v');
    expect(args[vIdx + 1]).toMatch(/:\/app:z$/);
  });

  test('custom container engine (podman)', () => {
    const args = buildContainerRunArgs('podman', defaultCC, 'echo', ['hello'], '');
    expect(args[0]).toBe('podman');
  });

  test('config-level cmd overrides containerCmd', () => {
    const cc: ContainerConfig = { image: 'ubuntu:22.04', cmd: 'nerdctl' };
    const args = buildContainerRunArgs('docker', cc, 'echo', ['hello'], '');
    expect(args[0]).toBe('nerdctl');
  });

  test('memory limit', () => {
    const cc: ContainerConfig = { image: 'alpine:latest', memory: '512m' };
    const args = buildContainerRunArgs('docker', cc, 'echo', ['hi'], '');
    const mIdx = args.indexOf('--memory');
    expect(mIdx).not.toBe(-1);
    expect(args[mIdx + 1]).toBe('512m');
  });

  test('cpu limit', () => {
    const cc: ContainerConfig = { image: 'alpine:latest', cpu: '2' };
    const args = buildContainerRunArgs('docker', cc, 'echo', ['hi'], '');
    const cIdx = args.indexOf('--cpus');
    expect(cIdx).not.toBe(-1);
    expect(args[cIdx + 1]).toBe('2');
  });

  test('network disabled', () => {
    const cc: ContainerConfig = { image: 'alpine:latest', networkDisabled: true };
    const args = buildContainerRunArgs('docker', cc, 'echo', ['hi'], '');
    expect(args).toContain('--network');
    expect(args).toContain('none');
  });

  test('{message} placeholder replaced in args', () => {
    const args = buildContainerRunArgs('docker', defaultCC, 'echo', ['say:', '{message}'], 'World');
    expect(args).not.toContain('{message}');
    expect(args).toContain('World');
  });

  test('no {message} placeholder appends message at end', () => {
    const args = buildContainerRunArgs('docker', defaultCC, 'echo', ['prefix'], 'suffix');
    const last = args[args.length - 1];
    expect(last).toBe('suffix');
  });

  test('empty message without placeholder does not append empty arg', () => {
    const args = buildContainerRunArgs('docker', defaultCC, 'cat', ['file.txt'], '');
    const last = args[args.length - 1];
    expect(last).toBe('file.txt');
  });

  test('volume mount uses agentCwd when no workingDir', () => {
    const args = buildContainerRunArgs('docker', defaultCC, 'echo', ['hi'], '', undefined, '/custom/cwd');
    const vIdx = args.indexOf('-v');
    expect(args[vIdx + 1]).toBe('/custom/cwd:/workspace:z');
  });

  test('volume mount uses workingDir when provided', () => {
    const args = buildContainerRunArgs('docker', defaultCC, 'echo', ['hi'], '', '/session/dir', '/custom/cwd');
    const vIdx = args.indexOf('-v');
    expect(args[vIdx + 1]).toBe('/session/dir:/workspace:z');
  });
});

describe('ContainerRuntime lifecycle', () => {
  const noContainerAgent: Agent = {
    name: 'no-container',
    description: 'no container config',
    runtimeType: 'container',
    config: { command: 'echo' },
    capabilities: { streaming: false, multiTurn: false },
  };

  test('start does not spawn process', async () => {
    const rt = new ContainerRuntime();
    await rt.start('sess-1', defaultAgent);
    expect(rt.isRunning('sess-1')).toBe(false);
  });

  test('send before start throws', async () => {
    const rt = new ContainerRuntime();
    expect(rt.send('no-session', 'hello')).rejects.toThrow('not initialized');
  });

  test('send with agent lacking container config throws', async () => {
    const rt = new ContainerRuntime();
    await rt.start('sess-2', noContainerAgent);
    expect(rt.send('sess-2', 'hello')).rejects.toThrow('no container config');
  });

  test('read with no session yields error', async () => {
    const rt = new ContainerRuntime();
    const chunks: StreamChunk[] = [];
    for await (const c of rt.read('ghost')) chunks.push(c);
    expect(chunks[0].type).toBe('error');
    expect((chunks[0] as any).content).toContain('No active container session');
  });

  test('cancel cleans up session', async () => {
    const rt = new ContainerRuntime();
    await rt.start('sess-3', defaultAgent);
    await rt.cancel('sess-3');
    expect(rt.isRunning('sess-3')).toBe(false);
  });
});
