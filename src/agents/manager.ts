import type { Agent } from './types';

/**
 * AgentManager — manages agent configurations (pure declarations, no execution logic).
 */
export class AgentManager {
  private agents = new Map<string, Agent>();

  register(agent: Agent): void {
    this.agents.set(agent.name, agent);
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
    return this.agents.delete(name);
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }
}
