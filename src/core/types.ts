/** @deprecated Use Channel interface from src/channels/types.ts */
export type ChannelType = string;

// Bun WebSocket type - compatible with Bun's ServerWebSocket
export type BunWebSocket = {
  readonly readyState: number;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  data?: unknown;
};

/** @deprecated Use Channel from src/channels/types.ts */
export interface Channel {
  readonly type: ChannelType;
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  handleMessage(event: unknown): Promise<void>;
  send(sessionId: string, message: string): Promise<void>;
}

// Message types
export interface UnifiedMessage {
  channel: ChannelType;
  channelId: string;
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

// Session types
export interface Session {
  id: string;
  userId: string;
  agentType: AgentType;
  messages: UnifiedMessage[];
  context: SessionContext;
  state: SessionState;
  createdAt: Date;
  updatedAt: Date;
}

export type SessionState = 'active' | 'paused' | 'closed';
export type AgentType = string; // Was union type; now any external CLI tool name

export interface SessionContext {
  workingDir?: string;
  env?: Record<string, string>;
}

// Agent types
export interface AgentResponse {
  content: string;
  tools?: ToolCall[];
  done: boolean;
  error?: string;
}

/** @deprecated Replaced by Agent (config) + RuntimeAdapter (execution) in src/agents/ */
export interface AgentAdapter {
  readonly name: string;
  readonly description: string;
  execute(session: Session, message: string): Promise<AgentResponse>;
  cancel(sessionId: string): Promise<void>;
  getStatus(sessionId: string): AgentStatus;
}

export type AgentStatus = 'idle' | 'running' | 'error';

// Tool types
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

// Event types
export type EventType =
  | 'session.created'
  | 'session.updated'
  | 'session.closed'
  | 'agent.thinking'
  | 'agent.tool_executing'
  | 'agent.stream_chunk'
  | 'agent.response'
  | 'agent.error';

export interface SessionEvent {
  type: EventType;
  sessionId: string;
  data: unknown;
  timestamp: Date;
}
