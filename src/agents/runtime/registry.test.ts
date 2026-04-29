import { describe, expect, test, beforeEach } from 'bun:test';
import { RuntimeRegistry } from './registry';
import type { RuntimeAdapter } from './types';

class MockRuntime implements RuntimeAdapter {
  readonly type = 'cli' as const;
  async start() {}
  async stop() {}
  isRunning() { return false; }
  async send() {}
  async *read() { yield { type: 'done' as const }; }
  async cancel() {}
  async cleanup() {}
}

class MockSessionRuntime implements RuntimeAdapter {
  readonly type = 'session' as const;
  async start() {}
  async stop() {}
  isRunning() { return false; }
  async send() {}
  async *read() { yield { type: 'done' as const }; }
  async cancel() {}
  async cleanup() {}
}

describe('RuntimeRegistry', () => {
  let registry: RuntimeRegistry;

  beforeEach(() => {
    registry = new RuntimeRegistry();
  });

  test('should register runtime', () => {
    const runtime = new MockRuntime();
    registry.register('cli', runtime);

    expect(registry.has('cli')).toBe(true);
    expect(registry.get('cli')).toBe(runtime);
  });

  test('should list registered runtimes', () => {
    registry.register('cli', new MockRuntime());
    registry.register('session', new MockSessionRuntime());

    const types = registry.list();
    expect(types.length).toBe(2);
    expect(types).toContain('cli');
    expect(types).toContain('session');
  });

  test('should throw for non-existent runtime', () => {
    expect(() => registry.get('unknown' as any)).toThrow('Runtime not found for type: unknown');
  });
});
