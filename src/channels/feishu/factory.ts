import type { ChannelFactory, ChannelCapabilities, ChannelDependencies } from '../types';
import { SidecarFeishuChannel } from './sidecar-channel';

export class FeishuChannelFactory implements ChannelFactory {
  readonly type = 'feishu';
  readonly description = '飞书 Bot (Sidecar)';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    cards: true,
    images: false,
    files: false,
    richText: true,
    cardActions: true,
  };

  create(config: Record<string, unknown>, deps: ChannelDependencies): SidecarFeishuChannel {
    return new SidecarFeishuChannel(deps.router, deps.sessionManager, deps.eventBus, deps.sessionBinding, {
      appId: config.appId as string,
      appSecret: config.appSecret as string,
      domain: config.domain as 'feishu' | 'lark' | undefined,
    });
  }
}
