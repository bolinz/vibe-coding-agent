import type { Channel, ChannelFactory, ChannelCapabilities, OutgoingMessage } from '../channels/types';

export class ChannelManager {
  private factories = new Map<string, ChannelFactory>();
  private channels = new Map<string, Channel>();

  // ===== Factory 管理 =====

  registerFactory(factory: ChannelFactory): void {
    this.factories.set(factory.type, factory);
  }

  getFactory(type: string): ChannelFactory | null {
    return this.factories.get(type) ?? null;
  }

  listFactories(): ChannelFactory[] {
    return Array.from(this.factories.values());
  }

  listAvailableTypes(): string[] {
    return Array.from(this.factories.keys());
  }

  // ===== Channel 实例管理 =====

  get<T extends Channel>(type: string): T | null {
    return (this.channels.get(type) as T) ?? null;
  }

  listActive(): Channel[] {
    return Array.from(this.channels.values());
  }

  // ===== 生命周期 =====

  async enable(type: string, config: Record<string, unknown>): Promise<void> {
    const factory = this.factories.get(type);
    if (!factory) {
      throw new Error(`No factory registered for channel type: ${type}`);
    }
    if (this.channels.has(type)) {
      return;
    }
    const deps = (this as any).__deps;
    const channel = factory.create(config, deps);
    this.channels.set(type, channel);
  }

  disable(type: string): void {
    const channel = this.channels.get(type);
    if (channel) {
      channel.disconnect().catch(() => {});
      this.channels.delete(type);
    }
  }

  setDependencies(deps: { router: import('./router').Router; sessionManager: import('./session').SessionManager }): void {
    (this as any).__deps = deps;
  }

  async connectAll(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.channels.values()).map((ch) => ch.connect())
    );
    const types = Array.from(this.channels.keys());
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        console.error(`[ChannelManager] Failed to connect ${types[i]}:`, (results[i] as PromiseRejectedResult).reason);
      }
    }
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(
      Array.from(this.channels.values()).map((ch) =>
        ch.disconnect().catch(() => {})
      )
    );
  }

  // ===== 广播 =====

  async broadcast(sessionId: string, message: OutgoingMessage): Promise<void> {
    await Promise.all(
      Array.from(this.channels.values()).map((ch) =>
        ch.send(sessionId, message).catch((err) => {
          console.error(`[ChannelManager] ${ch.type} send error:`, err);
        })
      )
    );
  }

  async broadcastText(sessionId: string, text: string): Promise<void> {
    await this.broadcast(sessionId, { text });
  }

  async broadcastCard(sessionId: string, text: string, card: Record<string, unknown>): Promise<void> {
    await Promise.all(
      Array.from(this.channels.values()).map((ch) => {
        if (ch.capabilities.cards) {
          return ch.send(sessionId, { text, card }).catch((err) => {
            console.error(`[ChannelManager] ${ch.type} card send error:`, err);
          });
        }
        return ch.send(sessionId, { text }).catch((err) => {
          console.error(`[ChannelManager] ${ch.type} text send error:`, err);
        });
      })
    );
  }

  getCapabilities(type: string): ChannelCapabilities | null {
    const channel = this.channels.get(type);
    if (channel) return channel.capabilities;
    const factory = this.factories.get(type);
    return factory?.capabilities ?? null;
  }
}
