import { describe, expect, test, beforeEach } from 'bun:test';
import { ToolRegistry, getToolRegistry } from './registry';
import type { Tool } from './types';

class MockTool implements Tool {
  readonly name = 'mock';
  readonly description = 'Mock tool for testing';
  execute = async () => 'mock result';
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  test('should register tool', () => {
    const tool = new MockTool();
    registry.register('mock', tool);

    expect(registry.get('mock')).not.toBeNull();
  });

  test('should execute tool', async () => {
    const tool = new MockTool();
    registry.register('mock', tool);

    const result = await registry.execute('mock', {});
    expect(result).toBe('mock result');
  });

  test('should throw for non-existent tool', async () => {
    await expect(registry.execute('non-existent', {})).rejects.toThrow('Tool not found');
  });

  test('should list all tools', () => {
    registry.register('tool1', new MockTool());
    registry.register('tool2', new MockTool());

    const tools = registry.list();
    expect(tools.length).toBe(2);
  });
});

describe('getToolRegistry', () => {
  test('should return singleton instance', () => {
    const instance1 = getToolRegistry();
    const instance2 = getToolRegistry();
    expect(instance1).toBe(instance2);
  });
});
