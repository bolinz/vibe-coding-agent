import { describe, expect, test } from 'bun:test';
import { EventBus } from './event';
import type { SessionEvent } from './types';

describe('EventBus', () => {
  test('should publish and subscribe to events', async () => {
    const bus = new EventBus();
    const events: SessionEvent[] = [];

    const unsubscribe = bus.subscribe('session.created', (event) => {
      events.push(event);
    });

    bus.publish({
      type: 'session.created',
      sessionId: 'sess-1',
      data: { userId: 'user-1' },
      timestamp: new Date()
    });

    expect(events.length).toBe(1);
    expect(events[0].sessionId).toBe('sess-1');

    unsubscribe();
    bus.publish({
      type: 'session.created',
      sessionId: 'sess-2',
      data: {},
      timestamp: new Date()
    });

    expect(events.length).toBe(1);
  });

  test('should broadcast to session listeners', async () => {
    const bus = new EventBus();
    const messages: string[] = [];

    bus.subscribeSession('sess-1', (event) => {
      const data = event.data as { content?: string };
      if (data.content) {
        messages.push(data.content);
      }
    });

    bus.broadcast('sess-1', 'Hello');
    bus.broadcast('sess-1', 'World');

    expect(messages.length).toBe(2);
    expect(messages).toEqual(['Hello', 'World']);
  });

  test('should handle multiple subscribers', async () => {
    const bus = new EventBus();
    let count1 = 0;
    let count2 = 0;

    bus.subscribe('agent.response', () => { count1++; });
    bus.subscribe('agent.response', () => { count2++; });
    bus.subscribe('agent.error', () => { count1++; });

    bus.publish({
      type: 'agent.response',
      sessionId: 'sess-1',
      data: {},
      timestamp: new Date()
    });

    bus.publish({
      type: 'agent.error',
      sessionId: 'sess-1',
      data: {},
      timestamp: new Date()
    });

    expect(count1).toBe(2);
    expect(count2).toBe(1);
  });

  test('should handle errors in handlers gracefully', () => {
    const bus = new EventBus();

    bus.subscribe('session.created', () => {
      throw new Error('Handler error');
    });

    // Should not throw
    bus.publish({
      type: 'session.created',
      sessionId: 'sess-1',
      data: {},
      timestamp: new Date()
    });

    // Should still process other handlers
    let executed = false;
    bus.subscribe('session.created', () => {
      executed = true;
    });

    bus.publish({
      type: 'session.created',
      sessionId: 'sess-2',
      data: {},
      timestamp: new Date()
    });

    expect(executed).toBe(true);
  });
});
