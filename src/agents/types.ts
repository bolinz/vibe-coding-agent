// Agent configuration — pure declaration, no execution logic
export type RuntimeType = 'cli' | 'session' | 'container';

export type AgentStatus = 'idle' | 'running' | 'error';

export interface ContainerConfig {
  /** Container engine command: "docker" | "podman" | "nerdctl". Default from config container_cmd or "docker" */
  cmd?: string;
  /** Container image, e.g. "node:20-slim", "ubuntu:22.04" */
  image: string;
  /** Working directory inside the container. Default "/workspace" */
  workDir?: string;
  /** Memory limit, e.g. "512m", "1g" */
  memory?: string;
  /** CPU limit, e.g. "0.5", "2" */
  cpu?: string;
  /** Disable network in container */
  networkDisabled?: boolean;
}

export interface Agent {
  readonly name: string;
  readonly description: string;
  readonly runtimeType: RuntimeType;
  readonly config: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    sessionTool?: 'tmux'; // session runtime only
    container?: ContainerConfig; // container runtime only
  };
  readonly capabilities: {
    streaming: boolean;
    multiTurn: boolean;
  };
}

export interface ExecutionContext {
  sessionId: string;
  workingDir?: string;
  env?: Record<string, string>;
}

export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; toolCallId: string; toolName: string; toolArgs: Record<string, unknown> }
  | { type: 'tool_result'; toolCallId: string; result: unknown }
  | { type: 'error'; content: string }
  | { type: 'done' };

// Agent response for non-streaming consumers
export interface AgentResponse {
  content: string;
  done: boolean;
  error?: string;
}
