import { describe, expect, test, beforeEach } from 'bun:test';
import { SessionManager, MemorySessionStore } from './session';
import type { AgentType } from './types';

describe('SessionManager', () => {
  let store: MemorySessionStore;
  let manager: SessionManager;

  beforeEach(() => {
    store = new MemorySessionStore();
    manager = new SessionManager(store);
  });

  test('should create a new session', async () => {
    const session = await manager.create('user-123', 'aider');

    expect(session.id).toBeDefined();
    expect(session.userId).toBe('user-123');
    expect(session.agentType).toBe('aider');
    expect(session.state).toBe('active');
    expect(session.messages).toEqual([]);
  });

  test('should get existing session', async () => {
    const created = await manager.create('user-123', 'aider');
    const retrieved = await manager.get(created.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.userId).toBe('user-123');
  });

  test('should return null for non-existent session', async () => {
    const session = await manager.get('non-existent');
    expect(session).toBeNull();
  });

  test('should get session by userId', async () => {
    await manager.create('user-123', 'aider');
    const session = await manager.getByUserId('user-123');

    expect(session).not.toBeNull();
    expect(session!.userId).toBe('user-123');
  });

  test('should return null for user without session', async () => {
    const session = await manager.getByUserId('no-such-user');
    expect(session).toBeNull();
  });

  test('should close session', async () => {
    const created = await manager.create('user-123', 'aider');
    await manager.close(created.id);

    const session = await manager.get(created.id);
    expect(session).toBeNull();
  });

  test('should update session', async () => {
    const created = await manager.create('user-123', 'aider');
    created.context.workingDir = '/new/path';

    await manager.update(created);

    const retrieved = await manager.get(created.id);
    expect(retrieved!.context.workingDir).toBe('/new/path');
  });

  test('should add message to session', async () => {
    const session = await manager.create('user-123', 'aider');

    await manager.addMessage(session.id, {
      channel: 'feishu',
      channelId: 'ch-1',
      sessionId: session.id,
      userId: 'user-123',
      role: 'user',
      content: 'Hello',
      timestamp: new Date()
    });

    const updated = await manager.get(session.id);
    expect(updated!.messages.length).toBe(1);
    expect(updated!.messages[0].content).toBe('Hello');
  });

  test('should create session with custom agent type', async () => {
    const session = await manager.create('user-123', 'claude');
    expect(session.agentType).toBe('claude');
  });

  test('should create session with context', async () => {
    const session = await manager.create('user-123', 'aider', {
      workingDir: '/projects/test',
      env: { TEST_VAR: 'value' }
    });

    expect(session.context.workingDir).toBe('/projects/test');
    expect(session.context.env).toEqual({ TEST_VAR: 'value' });
  });
});

describe('MemorySessionStore', () => {
  test('should save and load session', async () => {
    const store = new MemorySessionStore();

    const session = {
      id: 'test-id',
      userId: 'user-1',
      agentType: 'aider' as AgentType,
      messages: [],
      context: {},
      state: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await store.save(session);
    const loaded = await store.load('test-id');

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('test-id');
    expect(loaded!.userId).toBe('user-1');
  });

  test('should delete session', async () => {
    const store = new MemorySessionStore();

    const session = {
      id: 'test-id',
      userId: 'user-1',
      agentType: 'aider' as AgentType,
      messages: [],
      context: {},
      state: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await store.save(session);
    await store.delete('test-id');

    const loaded = await store.load('test-id');
    expect(loaded).toBeNull();
  });

  test('should return null for non-existent session', async () => {
    const store = new MemorySessionStore();
    const loaded = await store.load('non-existent');
    expect(loaded).toBeNull();
  });
});
