import type { ChannelFactory, ChannelCapabilities, ChannelDependencies } from '../types';
import { WebSocketChannel } from './channel';

export class WebSocketChannelFactory implements ChannelFactory {
  readonly type = 'websocket';
  readonly description = 'WebSocket';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    cards: false,
    images: false,
    files: false,
    richText: false,
    cardActions: false,
  };

  create(config: Record<string, unknown>, deps: ChannelDependencies): WebSocketChannel {
    return new WebSocketChannel(deps.router, {
      port: (config.port as number) ?? 3000,
    });
  }
}
