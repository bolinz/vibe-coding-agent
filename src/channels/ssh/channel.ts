import type { ChannelCapabilities, OutgoingMessage } from '../types';
import type { Router } from '../../core/router';

export class SSHChannel {
  readonly type = 'ssh';
  readonly name = 'SSH Terminal';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    cards: false,
    images: false,
    files: false,
    richText: false,
    cardActions: false,
  };

  private tmuxSessions: Map<string, string> = new Map();
  private router: Router;

  constructor(router: Router) {
    this.router = router;
  }

  async connect(): Promise<void> {
    console.log('[SSH] Channel initialized - uses existing tmux sessions');
  }

  async disconnect(): Promise<void> {
    console.log('[SSH] Disconnected');
  }

  isConnected(): boolean {
    return true;
  }

  handleEvent(event: unknown): Promise<void> {
    const data = event as { sessionId: string; content: string; userId: string };

    return this.router.route({
      channel: this.type,
      channelId: data.sessionId,
      sessionId: data.sessionId,
      userId: data.userId,
      role: 'user',
      content: data.content,
      timestamp: new Date(),
    });
  }

  async send(sessionId: string, message: OutgoingMessage): Promise<void> {
    const tmuxSession = this.tmuxSessions.get(sessionId);
    if (tmuxSession) {
      const escaped = message.text.replace(/'/g, "'\\''");
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
