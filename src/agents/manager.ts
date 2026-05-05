import type { Agent } from './types';
import { AgentStore } from '../core/agent-store';

export class AgentManager {
  private agents = new Map<string, Agent>();
  private store?: AgentStore;

  constructor(store?: AgentStore) {
    this.store = store;
    if (store) {
      for (const agent of store.getAll()) {
        this.agents.set(agent.name, agent);
      }
    }
  }

  register(agent: Agent): void {
    this.agents.set(agent.name, agent);
    this.store?.set(agent);
  }

  get(name: string): Agent | null {
    return this.agents.get(name) ?? null;
  }

  list(): Agent[] {
    return Array.from(this.agents.values());
  }

  listNames(): string[] {
    return Array.from(this.agents.keys());
  }

  remove(name: string): boolean {
    const deleted = this.agents.delete(name);
    this.store?.delete(name);
    return deleted;
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }
}
