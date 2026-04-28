import { describe, expect, test, beforeEach } from 'bun:test';
import { AgentManager } from './manager';
import type { Agent } from './types';

describe('AgentManager', () => {
  let manager: AgentManager;

  beforeEach(() => {
    manager = new AgentManager();
  });

  test('should register agent', () => {
    const agent: Agent = {
      name: 'test-cli',
      description: 'Test CLI agent',
      runtimeType: 'cli',
      config: { command: 'echo', args: ['hello'] },
      capabilities: { streaming: false, multiTurn: false },
    };

    manager.register(agent);

    expect(manager.has('test-cli')).toBe(true);
    expect(manager.get('test-cli')).toEqual(agent);
  });

  test('should list all agents', () => {
    manager.register({
      name: 'agent1',
      description: 'Agent one',
      runtimeType: 'cli',
      config: { command: 'echo' },
      capabilities: { streaming: false, multiTurn: false },
    });
    manager.register({
      name: 'agent2',
      description: 'Agent two',
      runtimeType: 'session',
      config: { command: 'aider' },
      capabilities: { streaming: true, multiTurn: true },
    });

    const agents = manager.list();
    expect(agents.length).toBe(2);
    expect(agents.map((a) => a.name)).toContain('agent1');
    expect(agents.map((a) => a.name)).toContain('agent2');
  });

  test('should list agent names', () => {
    manager.register({
      name: 'claude',
      description: 'Claude Code',
      runtimeType: 'cli',
      config: { command: 'claude', args: ['-p'] },
      capabilities: { streaming: false, multiTurn: false },
    });

    expect(manager.listNames()).toEqual(['claude']);
  });

  test('should return null for non-existent agent', () => {
    expect(manager.get('non-existent')).toBeNull();
  });

  test('should remove agent', () => {
    manager.register({
      name: 'removable',
      description: 'Removable',
      runtimeType: 'cli',
      config: { command: 'echo' },
      capabilities: { streaming: false, multiTurn: false },
    });

    expect(manager.remove('removable')).toBe(true);
    expect(manager.has('removable')).toBe(false);
  });

  test('should overwrite existing agent', () => {
    const agent1: Agent = {
      name: 'same',
      description: 'First',
      runtimeType: 'cli',
      config: { command: 'echo' },
      capabilities: { streaming: false, multiTurn: false },
    };
    const agent2: Agent = {
      name: 'same',
      description: 'Second',
      runtimeType: 'cli',
      config: { command: 'cat' },
      capabilities: { streaming: true, multiTurn: false },
    };

    manager.register(agent1);
    manager.register(agent2);

    expect(manager.get('same')!.description).toBe('Second');
  });
});
