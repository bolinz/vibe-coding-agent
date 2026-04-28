import type { Channel, ChannelType, UnifiedMessage } from '../core/types';

export abstract class BaseChannel implements Channel {
  abstract readonly type: ChannelType;
  abstract readonly name: string;

  protected router: import('../core/router').Router;

  constructor(router: import('../core/router').Router) {
    this.router = router;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract handleMessage(event: unknown): Promise<void>;
  abstract send(sessionId: string, message: string): Promise<void>;

  protected createUnifiedMessage(
    sessionId: string,
    userId: string,
    content: string,
    channelId: string
  ): UnifiedMessage {
    return {
      channel: this.type,
      channelId,
      sessionId,
      userId,
      role: 'user',
      content,
      timestamp: new Date()
    };
  }
}
