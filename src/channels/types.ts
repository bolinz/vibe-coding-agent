import type { Router } from '../core/router';
import type { SessionManager } from '../core/session';
import type { EventBus } from '../core/event';
import type { SessionBindingStore } from '../core/session-binding';

// ===== Channel 接口 =====

export type ChannelType = string;

export interface ChannelCapabilities {
  text: boolean;
  cards: boolean;
  images: boolean;
  files: boolean;
  richText: boolean;
  cardActions: boolean;
}

export interface Channel {
  readonly type: string;
  readonly name: string;
  readonly capabilities: ChannelCapabilities;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  handleEvent(event: unknown): Promise<void>;

  send(sessionId: string, message: OutgoingMessage): Promise<void>;
}

// ===== 消息类型 =====

export interface MessageAttachment {
  type: 'image' | 'file' | 'link';
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
}

export interface IncomingMessage {
  channel: string;
  channelId: string;
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant' | 'system';

  text: string;

  attachments?: MessageAttachment[];
  metadata?: Record<string, unknown>;

  timestamp: Date;
  raw?: unknown;
}

export interface OutgoingMessage {
  text: string;

  card?: Record<string, unknown>;
  attachments?: MessageAttachment[];

  options?: Record<string, unknown>;
}

// ===== Factory =====

export interface ChannelFactory {
  readonly type: string;
  readonly description: string;
  readonly capabilities: ChannelCapabilities;

  create(config: Record<string, unknown>, deps: ChannelDependencies): Channel;
}

export interface ChannelDependencies {
  router: Router;
  sessionManager: SessionManager;
  eventBus: EventBus;
  sessionBinding: SessionBindingStore;
}

// Bun WebSocket type - compatible with Bun's ServerWebSocket
export type BunWebSocket = {
  readonly readyState: number;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  data?: unknown;
};
