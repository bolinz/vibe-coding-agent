import type { Session, SessionContext, SessionState, AgentType, UnifiedMessage } from './types';

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private store: SessionStore;

  constructor(store: SessionStore) {
    this.store = store;
  }

  async listByUserId(userId: string): Promise<Session[]> {
    const cached = Array.from(this.sessions.values()).filter((s) => s.userId === userId);
    if (cached.length > 0) return cached;

    if (this.store.listByUserId) {
      const stored = await this.store.listByUserId(userId);
      for (const s of stored) {
        this.sessions.set(s.id, s);
      }
      return stored;
    }
    return [];
  }

  async listAll(): Promise<Session[]> {
    return Array.from(this.sessions.values());
  }

  async create(userId: string, agentType: AgentType = 'aider', context: SessionContext = {}, sessionId?: string): Promise<Session> {
    const session: Session = {
      id: sessionId ?? crypto.randomUUID(),
      userId,
      agentType,
      messages: [],
      context,
      state: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.sessions.set(session.id, session);
    await this.store.save(session);

    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    // Try memory first
    const cached = this.sessions.get(sessionId);
    if (cached) return cached;

    // Load from store
    const session = await this.store.load(sessionId);
    if (session) {
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  async getByUserId(userId: string): Promise<Session | null> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.state === 'active') {
        return session;
      }
    }
    // Fall back to store
    if (this.store.listByUserId) {
      const sessions = await this.store.listByUserId(userId);
      const active = sessions.find((s) => s.state === 'active');
      if (active) {
        this.sessions.set(active.id, active);
        return active;
      }
    }
    return null;
  }

  async update(session: Session): Promise<void> {
    session.updatedAt = new Date();
    this.sessions.set(session.id, session);
    await this.store.save(session);
  }

  async switchAgent(sessionId: string, agentType: AgentType): Promise<Session> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.agentType = agentType;
    session.updatedAt = new Date();
    await this.update(session);

    return session;
  }

  async addMessage(sessionId: string, message: UnifiedMessage): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.messages.push(message);
    await this.update(session);
  }

  async close(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;

    session.state = 'closed';
    await this.store.save(session);
    await this.store.delete(sessionId);
    this.sessions.delete(sessionId);
  }

  async pin(sessionId: string): Promise<Session> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.pinned = true;
    await this.update(session);
    return session;
  }

  async unpin(sessionId: string): Promise<Session> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.pinned = false;
    await this.update(session);
    return session;
  }
}

// Session store interface (Redis implementation)
export interface SessionStore {
  save(session: Session): Promise<void>;
  load(sessionId: string): Promise<Session | null>;
  delete(sessionId: string): Promise<void>;
  listByUserId?(userId: string): Promise<Session[]>;
}

// In-memory store for development
export class MemorySessionStore implements SessionStore {
  private sessions: Map<string, Session> = new Map();

  async save(session: Session): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async load(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : null;
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
