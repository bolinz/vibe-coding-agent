import type { ChannelFactory, ChannelCapabilities, ChannelDependencies } from '../types';
import { SSHChannel } from './channel';

export class SSHChannelFactory implements ChannelFactory {
  readonly type = 'ssh';
  readonly description = 'SSH Terminal (tmux)';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    cards: false,
    images: false,
    files: false,
    richText: false,
    cardActions: false,
  };

  create(_config: Record<string, unknown>, deps: ChannelDependencies): SSHChannel {
    return new SSHChannel(deps.router);
  }
}
