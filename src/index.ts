import { SessionManager, MemorySessionStore } from './core/session';
import { RedisSessionStore } from './core/redis-store';
import { SessionBindingStore } from './core/session-binding';
import { EventBus } from './core/event';
import { ToolRegistry, getToolRegistry } from './core/registry';
import { Router } from './core/router';
import { ConfigManager } from './core/config';
import { ChannelManager } from './core/channel-manager';
import { FeishuChannelFactory } from './channels/feishu/factory';
import { WebSocketChannel } from './channels/websocket/channel';
import { WebSocketChannelFactory } from './channels/websocket/factory';
import { SSHChannelFactory } from './channels/ssh/factory';
import { WebServer } from './web/server';
import { AgentManager } from './agents/manager';
import { RuntimeRegistry } from './agents/runtime/registry';
import { CLIRuntime } from './agents/runtime/cli';
import { SessionRuntime } from './agents/runtime/session';
import { PipelineEngine } from './agents/pipeline/executor';
import { ShellTool } from './tools/shell';
import { GitTool } from './tools/git';
import { FileTool } from './tools/file';
import * as path from 'path';
import * as os from 'os';

// Ensure common bin directories are in PATH for spawned subprocesses
const userBinDir = path.join(os.homedir(), '.local/bin');
if (!(process.env.PATH ?? '').includes(userBinDir)) {
  process.env.PATH = `${userBinDir}:${process.env.PATH}`;
}

const configManager = new ConfigManager();
configManager.reloadEnvFromDb();

const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '0.0.0.0',
  redisUrl: process.env.REDIS_URL,
  feishu: {
    appId: process.env.FEISHU_APP_ID ?? '',
    appSecret: process.env.FEISHU_APP_SECRET ?? '',
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
  },
};

async function main() {
  console.log('[Agent] Starting Vibe Coding Agent...');
  console.log('[Agent] Version: 0.1.0');
  console.log('[Agent] Configuration source: SQLite + .env');
  console.log('[Agent] Configuration:', {
    port: config.port,
    host: config.host,
    sessionStore: config.redisUrl ? 'redis' : 'memory',
    feishu: config.feishu.appId ? 'enabled' : 'disabled',
  });

  // Session store
  const sessionStore = config.redisUrl
    ? new RedisSessionStore(config.redisUrl)
    : new MemorySessionStore();
  const sessionManager = new SessionManager(sessionStore);
  const sessionBinding = new SessionBindingStore(config.redisUrl ? sessionStore : undefined);
  const eventBus = new EventBus();
  const toolRegistry = getToolRegistry();

  // Tools
  toolRegistry.register('shell', new ShellTool());
  toolRegistry.register('git', new GitTool());
  toolRegistry.register('file', new FileTool());
  console.log('[Agent] Tools registered:', toolRegistry.list());

  // Agent architecture
  const agentManager = new AgentManager();
  const runtimeRegistry = new RuntimeRegistry();
  runtimeRegistry.register('cli', new CLIRuntime());
  runtimeRegistry.register('session', new SessionRuntime());

  const defaultAgent = process.env.DEFAULT_AGENT ?? 'echo';
  const pipeline = new PipelineEngine(agentManager, runtimeRegistry, toolRegistry, {
    maxToolRounds: 10,
  });

  const router = new Router(sessionManager, agentManager, eventBus, toolRegistry, pipeline, defaultAgent);

  // Register agents
  agentManager.register({ name: 'claude', description: 'Anthropic Claude Code CLI', runtimeType: 'cli', config: { command: 'claude', args: ['-p'] }, capabilities: { streaming: false, multiTurn: false } });
  agentManager.register({ name: 'codex', description: 'OpenAI Codex CLI', runtimeType: 'cli', config: { command: 'codex', args: [] }, capabilities: { streaming: true, multiTurn: false } });
  agentManager.register({ name: 'cline', description: 'Cline CLI', runtimeType: 'cli', config: { command: 'cline', args: ['--execute'] }, capabilities: { streaming: true, multiTurn: false } });
  agentManager.register({ name: 'hermes', description: 'Hermes CLI (AI assistant with tool-calling)', runtimeType: 'cli', config: { command: 'hermes', args: ['chat', '-q', '{message}', '-Q'] }, capabilities: { streaming: true, multiTurn: true } });
  agentManager.register({ name: 'aider', description: 'Aider coding assistant in tmux session', runtimeType: 'session', config: { command: 'aider', env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '', OPENAI_API_BASE: process.env.OPENAI_API_BASE ?? 'https://api.minimax.chat/v1' } }, capabilities: { streaming: true, multiTurn: true } });
  agentManager.register({ name: 'opencode', description: 'OpenCode AI coding agent', runtimeType: 'cli', config: { command: 'opencode', args: ['run', '{message}'] }, capabilities: { streaming: true, multiTurn: true } });
  agentManager.register({ name: 'echo', description: 'Simple echo agent for testing', runtimeType: 'cli', config: { command: 'echo', args: ['Echo:'] }, capabilities: { streaming: false, multiTurn: false } });
  console.log('[Agent] Agents registered:', agentManager.listNames());

  // ===== Channel Manager =====
  const channelManager = new ChannelManager();
  channelManager.setDependencies({ router, sessionManager, eventBus, sessionBinding });

  // Register factories
  channelManager.registerFactory(new FeishuChannelFactory());
  channelManager.registerFactory(new WebSocketChannelFactory());
  channelManager.registerFactory(new SSHChannelFactory());

  // Create channels
  channelManager.enable('websocket', { port: config.port });
  channelManager.enable('ssh', {});
  if (config.feishu.appId && config.feishu.appSecret) {
    await channelManager.enable('feishu', {
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
      domain: process.env.FEISHU_DOMAIN ?? 'feishu',
    });
  }
  console.log('[Feishu] Using Sidecar mode');

  // Connect all channels
  await channelManager.connectAll();
  console.log('[Agent] Channels connected');

  // Event subscriptions
  eventBus.subscribe('session.created', (event) => {
    console.log(`[Event] Session created: ${event.sessionId}`);
  });

  eventBus.subscribe('agent.response', (event) => {
    console.log(`[Event] Agent response for session ${event.sessionId}`);
    const data = event.data as { content?: string };
    if (!data.content) return;
    channelManager.broadcastText(event.sessionId, data.content).catch((err) => {
      console.error('[ChannelManager] Broadcast error:', err);
    });
  });

  eventBus.subscribe('agent.error', (event) => {
    console.error(`[Event] Agent error for session ${event.sessionId}:`, event.data);
  });

  // Web server (needs wsChannel reference for WS lifecycle)
  const wsChannel = channelManager.get<WebSocketChannel>('websocket')!;
  const webServer = new WebServer(router, channelManager, wsChannel, eventBus, sessionManager, {
    port: config.port,
    host: config.host,
  });

  await webServer.start();

  console.log('[Agent] Started successfully!');
  console.log(`[Agent] HTTP: http://${config.host}:${config.port}`);
  console.log(`[Agent] WebSocket: ws://${config.host}:${config.port}/ws`);
  console.log('[Agent] Press Ctrl+C to stop');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[Agent] Shutting down...');
    await channelManager.disconnectAll();
    if (config.redisUrl && sessionStore instanceof RedisSessionStore) {
      await sessionStore.close();
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[Agent] Fatal error:', error);
  process.exit(1);
});
