import type { ChannelFactory, ChannelCapabilities, ChannelDependencies } from '../types';
import { GitHubChannel } from './channel';
import { ConfigManager } from '../../core/config';

export class GitHubChannelFactory implements ChannelFactory {
  readonly type = 'github';
  readonly description = 'GitHub Webhook (issues, PR comments)';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    cards: false,
    images: false,
    files: false,
    richText: true,
    cardActions: false,
  };

  create(_config: Record<string, unknown>, deps: ChannelDependencies): GitHubChannel {
    const cm = new ConfigManager();
    const token = cm.get('github_token') || undefined;
    const appId = cm.get('github_app_id') || undefined;
    const privateKey = cm.get('github_private_key') || undefined;
    const webhookSecret = cm.get('github_webhook_secret') || '';

    return new GitHubChannel(
      deps.router,
      deps.sessionManager,
      deps.sessionBinding,
      deps.eventBus,
      { token, appId, privateKey },
      webhookSecret,
    );
  }
}
