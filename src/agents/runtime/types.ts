import type { Agent, ExecutionContext, StreamChunk } from '../types';

export interface RuntimeAdapter {
  readonly type: 'cli' | 'session';

  /** Start a runtime instance for the given session. Idempotent. */
  start(sessionId: string, agent: Agent): Promise<void>;

  /** Stop the runtime instance for the given session. */
  stop(sessionId: string): Promise<void>;

  /** Check if the runtime instance is active. */
  isRunning(sessionId: string): boolean;

  /** Send a message to the runtime instance. */
  send(sessionId: string, message: string): Promise<void>;

  /** Read output from the runtime instance as stream chunks. */
  read(sessionId: string): AsyncGenerator<StreamChunk>;

  /** Cancel ongoing operation (e.g. kill process, send Ctrl-C). */
  cancel(sessionId: string): Promise<void>;

  /** Cleanup all resources (kill tmux sessions, remove temp files, etc). */
  cleanup(sessionId: string): Promise<void>;
}
