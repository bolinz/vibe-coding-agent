import type { EventType, SessionEvent, Session } from './types';

type EventHandler = (event: SessionEvent) => void | Promise<void>;

export class EventBus {
  private listeners: Map<EventType, Set<EventHandler>> = new Map();
  private channelListeners: Map<string, Set<EventHandler>> = new Map();

  publish(event: SessionEvent): void {
    // Notify type-specific listeners
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const handler of typeListeners) {
        try {
          handler(event);
        } catch (err) {
          console.error(`Event handler error for ${event.type}:`, err);
        }
      }
    }

    // Notify session-specific listeners
    const sessionListeners = this.channelListeners.get(event.sessionId);
    if (sessionListeners) {
      for (const handler of sessionListeners) {
        try {
          handler(event);
        } catch (err) {
          console.error(`Session event handler error for ${event.sessionId}:`, err);
        }
      }
    }
  }

  subscribe(type: EventType, handler: EventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  subscribeSession(sessionId: string, handler: EventHandler): () => void {
    if (!this.channelListeners.has(sessionId)) {
      this.channelListeners.set(sessionId, new Set());
    }
    this.channelListeners.get(sessionId)!.add(handler);

    return () => {
      this.channelListeners.get(sessionId)?.delete(handler);
    };
  }

  broadcast(sessionId: string, message: string): void {
    this.publish({
      type: 'agent.response',
      sessionId,
      data: { content: message },
      timestamp: new Date()
    });
  }

  async broadcastToChannel(session: Session, content: string): Promise<void> {
    this.publish({
      type: 'agent.response',
      sessionId: session.id,
      data: { content, messages: session.messages },
      timestamp: new Date()
    });
  }
}
