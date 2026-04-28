import { describe, expect, test } from 'bun:test';
import type { Session, UnifiedMessage, SessionState, AgentType } from './types';

describe('types', () => {
  test('SessionState should be valid', () => {
    const states: SessionState[] = ['active', 'paused', 'closed'];
    expect(states).toContain('active');
    expect(states).toContain('paused');
    expect(states).toContain('closed');
  });

  test('AgentType should be valid', () => {
    const types: AgentType[] = ['aider', 'claude', 'custom'];
    expect(types).toContain('aider');
    expect(types).toContain('claude');
    expect(types).toContain('custom');
  });

  test('UnifiedMessage should have required fields', () => {
    const message: UnifiedMessage = {
      channel: 'feishu',
      channelId: 'channel-123',
      sessionId: 'session-456',
      userId: 'user-789',
      role: 'user',
      content: 'Hello',
      timestamp: new Date()
    };

    expect(message.channel).toBe('feishu');
    expect(message.sessionId).toBe('session-456');
    expect(message.role).toBe('user');
    expect(message.content).toBe('Hello');
  });

  test('Session should track messages', () => {
    const messages: UnifiedMessage[] = [
      {
        channel: 'websocket',
        channelId: 'ch-1',
        sessionId: 'sess-1',
        userId: 'user-1',
        role: 'user',
        content: 'First',
        timestamp: new Date()
      },
      {
        channel: 'websocket',
        channelId: 'ch-1',
        sessionId: 'sess-1',
        userId: 'assistant',
        role: 'assistant',
        content: 'Response',
        timestamp: new Date()
      }
    ];

    const session: Session = {
      id: 'sess-1',
      userId: 'user-1',
      agentType: 'aider',
      messages,
      context: { workingDir: '/projects/sandbox' },
      state: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    expect(session.messages.length).toBe(2);
    expect(session.agentType).toBe('aider');
    expect(session.state).toBe('active');
  });
});
