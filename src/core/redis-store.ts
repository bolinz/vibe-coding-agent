import Redis from 'ioredis';
import type { Session } from './types';
import type { SessionStore } from './session';

export class RedisSessionStore implements SessionStore {
  private redis: Redis;
  private keyPrefix = 'session:';

  constructor(url: string) {
    this.redis = new Redis(url);
  }

  async save(session: Session): Promise<void> {
    const key = this.keyPrefix + session.id;
    const data = JSON.stringify({
      ...session,
      // Serialize Date objects
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      messages: session.messages.map(m => ({
        ...m,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp
      }))
    });

    await this.redis.set(key, data, 'EX', 7 * 24 * 60 * 60); // 7 days TTL
  }

  async load(sessionId: string): Promise<Session | null> {
    const key = this.keyPrefix + sessionId;
    const data = await this.redis.get(key);

    if (!data) return null;

    try {
      const parsed = JSON.parse(data);
      return {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(parsed.updatedAt),
        messages: parsed.messages.map((m: Record<string, unknown>) => ({
          ...m,
          timestamp: new Date(m.timestamp as string)
        }))
      };
    } catch {
      return null;
    }
  }

  async delete(sessionId: string): Promise<void> {
    const key = this.keyPrefix + sessionId;
    await this.redis.del(key);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
