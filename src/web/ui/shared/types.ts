export interface SessionData {
  id: string;
  userId: string;
  agentType: string;
  state: string;
  pinned: boolean;
  participants?: Array<{ channel: string; userId: string }>;
  workingDir?: string;
  context?: { workingDir?: string };
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MessageData {
  role: string;
  content: string;
  channel?: string;
  timestamp?: string;
}

export interface SSEMessage {
  type: string;
  content?: string;
  toolName?: string;
  timestamp?: string;
}

export interface AgentInfo {
  name: string;
  description: string;
  runtimeType: string;
  hasContainer: boolean;
  streaming: boolean;
  multiTurn: boolean;
}
