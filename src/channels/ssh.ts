import type { ChannelType } from '../core/types';
import { BaseChannel } from './base';

interface SSHConfig {
  // SSH channel uses existing SSH sessions via tmux
  // No additional config needed
}

// SSH channel communicates via existing tmux sessions
// Users SSH in and attach to a tmux session managed by the agent
export class SSHChannel extends BaseChannel {
  readonly type: ChannelType = 'ssh';
  readonly name = 'SSH Terminal';

  private tmuxSessions: Map<string, string> = new Map();

  constructor(router: import('../core/router').Router, _config: SSHConfig = {}) {
    super(router);
  }

  async connect(): Promise<void> {
    console.log('[SSH] Channel initialized - uses existing tmux sessions');
  }

  async disconnect(): Promise<void> {
    console.log('[SSH] Disconnected');
  }

  async handleMessage(event: unknown): Promise<void> {
    // SSH messages come via stdin from tmux session
    // This is handled through the event system
    const data = event as { sessionId: string; content: string; userId: string };

    const unifiedMessage = this.createUnifiedMessage(
      data.sessionId,
      data.userId,
      data.content,
      data.sessionId
    );

    await this.router.route(unifiedMessage);
  }

  async send(sessionId: string, message: string): Promise<void> {
    // Send to tmux session
    const tmuxSession = this.tmuxSessions.get(sessionId);
    if (tmuxSession) {
      // Escape special characters
      const escaped = message.replace(/'/g, "'\\''");
      await Bun.spawn(['tmux', 'send-keys', '-t', tmuxSession, escaped, 'Enter']);
    }
  }

  registerTmuxSession(sessionId: string, tmuxSessionName: string): void {
    this.tmuxSessions.set(sessionId, tmuxSessionName);
  }

  unregisterTmuxSession(sessionId: string): void {
    this.tmuxSessions.delete(sessionId);
  }
}
