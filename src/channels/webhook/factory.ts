import type { ChannelFactory, ChannelCapabilities, ChannelDependencies } from '../types';
import { WebhookChannel } from './channel';

export class WebhookChannelFactory implements ChannelFactory {
  readonly type = 'webhook';
  readonly description = 'External Webhook API (POST /api/channels/webhook/:token)';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    cards: false,
    images: false,
    files: false,
    richText: false,
    cardActions: false,
  };

  create(config: Record<string, unknown>, deps: ChannelDependencies): WebhookChannel {
    const tokens = (config.tokens as string)?.split(',').map((s: string) => s.trim()) || [];
    return new WebhookChannel(
      deps.router,
      deps.sessionManager,
      deps.sessionBinding,
      deps.eventBus,
      tokens,
    );
  }
}
