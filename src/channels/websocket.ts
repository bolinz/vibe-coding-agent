import type { ChannelType, BunWebSocket } from '../core/types';
import { BaseChannel } from './base';

interface WSMessage {
  sessionId?: string;
  message: string;
  userId?: string;
}

interface WSConfig {
  port: number;
}

export class WebSocketChannel extends BaseChannel {
  readonly type: ChannelType = 'websocket';
  readonly name = 'WebSocket Server';

  private connections: Map<string, Set<BunWebSocket>> = new Map();
  private config: WSConfig;

  constructor(router: import('../core/router').Router, config: WSConfig) {
    super(router);
    this.config = config;
  }

  async connect(): Promise<void> {
    console.log(`[WebSocket] Channel initialized on port ${this.config.port}`);
  }

  async disconnect(): Promise<void> {
    // Close all connections
    for (const conns of this.connections.values()) {
      for (const ws of conns) {
        ws.close();
      }
    }
    this.connections.clear();
    console.log('[WebSocket] Disconnected');
  }

  handleMessage(event: unknown): Promise<void> {
    // Messages are handled via WebSocket upgrade
    return Promise.resolve();
  }

  async send(sessionId: string, message: string): Promise<void> {
    const connections = this.connections.get(sessionId);
    if (!connections) return;

    const payload = JSON.stringify({
      type: 'response',
      content: message,
      timestamp: new Date().toISOString()
    });

    for (const ws of connections) {
      if (ws.readyState === 1) { // OPEN
        ws.send(payload);
      }
    }
  }

  addConnection(sessionId: string, ws: BunWebSocket): void {
    if (!this.connections.has(sessionId)) {
      this.connections.set(sessionId, new Set());
    }
    this.connections.get(sessionId)!.add(ws);
  }

  removeConnection(sessionId: string, ws: BunWebSocket): void {
    const conns = this.connections.get(sessionId);
    if (conns) {
      conns.delete(ws);
      if (conns.size === 0) {
        this.connections.delete(sessionId);
      }
    }
  }

  async handleWSMessage(ws: BunWebSocket, sessionId: string, data: string): Promise<void> {
    try {
      const parsed = JSON.parse(data) as WSMessage;

      const unifiedMessage = this.createUnifiedMessage(
        sessionId,
        parsed.userId ?? sessionId,
        parsed.message,
        sessionId
      );

      await this.router.route(unifiedMessage);
    } catch (error) {
      console.error('[WebSocket] Error handling message:', error);
      ws.send(JSON.stringify({ type: 'error', content: 'Invalid message format' }));
    }
  }

  getConnectionCount(): number {
    let count = 0;
    for (const conns of this.connections.values()) {
      count += conns.size;
    }
    return count;
  }
}
