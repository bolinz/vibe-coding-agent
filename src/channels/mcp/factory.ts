import type { ChannelFactory, ChannelCapabilities, ChannelDependencies } from '../types';
import { MCPChannel } from './channel';

export class MCPChannelFactory implements ChannelFactory {
  readonly type = 'mcp';
  readonly description = 'MCP Server (Model Context Protocol)';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    cards: false,
    images: false,
    files: false,
    richText: false,
    cardActions: false,
  };

  create(_config: Record<string, unknown>, deps: ChannelDependencies): MCPChannel {
    return new MCPChannel(
      deps.router,
      deps.sessionManager,
      deps.sessionBinding,
      deps.eventBus,
    );
  }
}
