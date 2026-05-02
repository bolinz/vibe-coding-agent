import type { Session, SessionContext, SessionState, AgentType, UnifiedMessage, Participant } from './types';

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
    const memory = Array.from(this.sessions.values());
    if (memory.length > 0) return memory;
    return [];
  }

  async create(userId: string, agentType: AgentType = 'aider', context: SessionContext = {}, sessionId?: string, channel?: string): Promise<Session> {
    const session: Session = {
      id: sessionId ?? crypto.randomUUID(),
      userId,
      agentType,
      messages: [],
      context,
      state: 'active',
      participants: channel ? [{ channel, userId }] : [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.sessions.set(session.id, session);
    await this.store.save(session);

    return session;
  }

  async addParticipant(sessionId: string, participant: Participant): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (!session.participants) session.participants = [];
    const exists = session.participants.find(
      (p) => p.channel === participant.channel && p.userId === participant.userId
    );
    if (!exists) {
      session.participants.push(participant);
      await this.update(session);
    }
  }

  async get(sessionId: string): Promise<Session | null> {
    const cached = this.sessions.get(sessionId);
    if (cached) return cached;

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

    // Add participant on first message from a channel
    if (!session.participants) session.participants = [];
    const exists = session.participants.find(
      (p) => p.channel === message.channel && p.userId === message.userId
    );
    if (!exists) {
      session.participants.push({ channel: message.channel, userId: message.userId });
    }

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

  async updateContext(sessionId: string, updates: Partial<SessionContext>): Promise<Session> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (!session.context) session.context = {};
    Object.assign(session.context, updates);
    await this.update(session);
    return session;
  }
}

export interface SessionStore {
  save(session: Session): Promise<void>;
  load(sessionId: string): Promise<Session | null>;
  delete(sessionId: string): Promise<void>;
  listByUserId?(userId: string): Promise<Session[]>;
}

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
