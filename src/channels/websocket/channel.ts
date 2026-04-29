import type { ChannelCapabilities, OutgoingMessage, BunWebSocket } from '../types';
import type { Router } from '../../core/router';

interface WSMessage {
  sessionId?: string;
  message: string;
  userId?: string;
}

interface WSConfig {
  port: number;
}

export class WebSocketChannel {
  readonly type = 'websocket';
  readonly name = 'WebSocket Server';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    cards: false,
    images: false,
    files: false,
    richText: false,
    cardActions: false,
  };

  private connections: Map<string, Set<BunWebSocket>> = new Map();
  private config: WSConfig;
  private router: Router;

  constructor(router: Router, config: WSConfig) {
    this.router = router;
    this.config = config;
  }

  async connect(): Promise<void> {
    console.log(`[WebSocket] Channel initialized on port ${this.config.port}`);
  }

  async disconnect(): Promise<void> {
    for (const conns of this.connections.values()) {
      for (const ws of conns) {
        ws.close();
      }
    }
    this.connections.clear();
    console.log('[WebSocket] Disconnected');
  }

  isConnected(): boolean {
    return true;
  }

  handleEvent(_event: unknown): Promise<void> {
    return Promise.resolve();
  }

  async send(sessionId: string, message: OutgoingMessage): Promise<void> {
    const connections = this.connections.get(sessionId);
    if (!connections) return;

    const payload = JSON.stringify({
      type: 'response',
      content: message.text,
      ...(message.card ? { card: message.card } : {}),
      timestamp: new Date().toISOString(),
    });

    for (const ws of connections) {
      if (ws.readyState === 1) {
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

      await this.router.route({
        channel: this.type,
        channelId: sessionId,
        sessionId,
        userId: parsed.userId ?? sessionId,
        role: 'user',
        content: parsed.message,
        timestamp: new Date(),
      });
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

// Re-export for compatibility with BunWebSocket type
export type { BunWebSocket };
