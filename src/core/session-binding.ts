import type { SessionStore } from './session';

export interface SessionBinding {
  channel: string;
  userId: string;
  sessionId: string;
}

export class SessionBindingStore {
  private bindings = new Map<string, SessionBinding>();
  private store?: SessionStore & { getBinding?: (channel: string, userId: string) => Promise<string | null>; setBinding?: (channel: string, userId: string, sessionId: string) => Promise<void> };

  constructor(store?: SessionStore) {
    this.store = store as any;
  }

  async get(channel: string, userId: string): Promise<string | null> {
    const key = `${channel}:${userId}`;
    const cached = this.bindings.get(key);
    if (cached) return cached.sessionId;

    if (this.store?.getBinding) {
      const sessionId = await this.store.getBinding(channel, userId);
      if (sessionId) {
        this.bindings.set(key, { channel, userId, sessionId });
        return sessionId;
      }
    }
    return null;
  }

  async set(channel: string, userId: string, sessionId: string): Promise<void> {
    const key = `${channel}:${userId}`;
    this.bindings.set(key, { channel, userId, sessionId });
    if (this.store?.setBinding) {
      await this.store.setBinding(channel, userId, sessionId);
    }
  }

  async clear(channel: string, userId: string): Promise<void> {
    const key = `${channel}:${userId}`;
    this.bindings.delete(key);
  }

  async getOrCreate(channel: string, userId: string, createFn: () => Promise<string>): Promise<string> {
    const existing = await this.get(channel, userId);
    if (existing) return existing;
    const sessionId = await createFn();
    await this.set(channel, userId, sessionId);
    return sessionId;
  }
}
