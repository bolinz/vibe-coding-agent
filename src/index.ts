import { SessionManager, MemorySessionStore } from './core/session';
import { RedisSessionStore } from './core/redis-store';
import { EventBus } from './core/event';
import { ToolRegistry, getToolRegistry } from './core/registry';
import { Router } from './core/router';
import { ConfigManager } from './core/config';
import { FeishuChannel } from './channels/feishu';
import { SidecarFeishuChannel } from './channels/sidecar-feishu';
import { WebSocketChannel } from './channels/websocket';
import { SSHChannel } from './channels/ssh';
import { WebServer } from './web/server';
import { AgentManager } from './agents/manager';
import { RuntimeRegistry } from './agents/runtime/registry';
import { CLIRuntime } from './agents/runtime/cli';
import { SessionRuntime } from './agents/runtime/session';
import { PipelineEngine } from './agents/pipeline/executor';
import { ShellTool } from './tools/shell';
import { GitTool } from './tools/git';
import { FileTool } from './tools/file';

// Initialize ConfigManager first — load SQLite configs into process.env
const configManager = new ConfigManager();
configManager.reloadEnvFromDb();

// Configuration (now reads from process.env which has been hot-reloaded from SQLite)
const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '0.0.0.0',
  redisUrl: process.env.REDIS_URL,
  feishu: {
    appId: process.env.FEISHU_APP_ID ?? '',
    appSecret: process.env.FEISHU_APP_SECRET ?? '',
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN
  }
};

async function main() {
  console.log('[Agent] Starting Vibe Coding Agent...');
  console.log('[Agent] Version: 0.1.0');
  console.log('[Agent] Configuration source: SQLite + .env');
  console.log('[Agent] Configuration:', {
    port: config.port,
    host: config.host,
    sessionStore: config.redisUrl ? 'redis' : 'memory',
    feishu: config.feishu.appId ? 'enabled' : 'disabled'
  });

  // Initialize session store
  const sessionStore = config.redisUrl
    ? new RedisSessionStore(config.redisUrl)
    : new MemorySessionStore();

  const sessionManager = new SessionManager(sessionStore);
  const eventBus = new EventBus();
  const toolRegistry = getToolRegistry();

  // Register tools
  const shellTool = new ShellTool();
  const gitTool = new GitTool();
  const fileTool = new FileTool();

  toolRegistry.register('shell', shellTool);
  toolRegistry.register('git', gitTool);
  toolRegistry.register('file', fileTool);

  console.log('[Agent] Tools registered:', toolRegistry.list());

  // Initialize new agent architecture
  const agentManager = new AgentManager();
  const runtimeRegistry = new RuntimeRegistry();

  // Register runtimes
  runtimeRegistry.register('cli', new CLIRuntime());
  runtimeRegistry.register('session', new SessionRuntime());

  // Initialize pipeline engine
  const defaultAgent = process.env.DEFAULT_AGENT ?? 'echo';
  const pipeline = new PipelineEngine(agentManager, runtimeRegistry, toolRegistry, {
    maxToolRounds: 10
  });

  // Initialize router (new signature: agentManager + pipeline)
  const router = new Router(
    sessionManager,
    agentManager,
    eventBus,
    toolRegistry,
    pipeline,
    defaultAgent
  );

  // Register agents (pure declarations)
  agentManager.register({
    name: 'claude',
    description: 'Anthropic Claude Code CLI',
    runtimeType: 'cli',
    config: { command: 'claude', args: ['-p'] },
    capabilities: { streaming: false, multiTurn: false }
  });

  agentManager.register({
    name: 'codex',
    description: 'OpenAI Codex CLI',
    runtimeType: 'cli',
    config: { command: 'codex', args: [] },
    capabilities: { streaming: true, multiTurn: false }
  });

  agentManager.register({
    name: 'cline',
    description: 'Cline CLI',
    runtimeType: 'cli',
    config: { command: 'cline', args: ['--execute'] },
    capabilities: { streaming: true, multiTurn: false }
  });

  agentManager.register({
    name: 'hermes',
    description: 'Hermes CLI (AI assistant with tool-calling)',
    runtimeType: 'cli',
    config: { command: 'hermes', args: ['chat', '-q', '{message}', '-Q'] },
    capabilities: { streaming: true, multiTurn: true }
  });

  agentManager.register({
    name: 'aider',
    description: 'Aider coding assistant in tmux session',
    runtimeType: 'session',
    config: {
      command: 'aider',
      env: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
        OPENAI_API_BASE: process.env.OPENAI_API_BASE ?? 'https://api.minimax.chat/v1'
      }
    },
    capabilities: { streaming: true, multiTurn: true }
  });

  agentManager.register({
    name: 'echo',
    description: 'Simple echo agent for testing',
    runtimeType: 'cli',
    config: { command: 'echo', args: ['Echo:'] },
    capabilities: { streaming: false, multiTurn: false }
  });

  console.log('[Agent] Agents registered:', agentManager.listNames());

  // Initialize channels — prefer sidecar mode unless explicitly disabled
  const useSidecar = process.env.USE_FEISHU_SIDECAR !== 'false';
  const feishuChannel = useSidecar
    ? new SidecarFeishuChannel(router, sessionManager, {
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        domain: (process.env.FEISHU_DOMAIN as 'feishu' | 'lark') ?? 'feishu',
      })
    : new FeishuChannel(router, sessionManager, {
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        domain: (process.env.FEISHU_DOMAIN as 'feishu' | 'lark') ?? 'feishu',
      });
  console.log(`[Feishu] Using ${useSidecar ? 'Sidecar' : 'Direct WS'} mode`);
  const wsChannel = new WebSocketChannel(router, { port: config.port });
  const sshChannel = new SSHChannel(router);

  // Connect channels
  await feishuChannel.connect();
  await wsChannel.connect();
  await sshChannel.connect();

  console.log('[Agent] Channels connected');

  // Subscribe to events for logging
  eventBus.subscribe('session.created', (event) => {
    console.log(`[Event] Session created: ${event.sessionId}`);
  });

  eventBus.subscribe('agent.response', (event) => {
    console.log(`[Event] Agent response for session ${event.sessionId}`);
    const data = event.data as { content?: string };
    if (!data.content) return;

    // Broadcast to WebSocket
    wsChannel.send(event.sessionId, data.content).catch((err) => {
      console.error('[WebSocket] Send error:', err);
    });

    // Broadcast to Feishu (sessionId is the open_id for feishu sessions)
    feishuChannel.send(event.sessionId, data.content).catch((err) => {
      console.error('[Feishu] Send error:', err);
    });
  });

  eventBus.subscribe('agent.error', (event) => {
    console.error(`[Event] Agent error for session ${event.sessionId}:`, event.data);
  });

  // Initialize web server
  const webServer = new WebServer(router, feishuChannel, wsChannel, eventBus, {
    port: config.port,
    host: config.host
  });

  // Start web server
  await webServer.start();

  console.log('[Agent] Started successfully!');
  console.log(`[Agent] HTTP: http://${config.host}:${config.port}`);
  console.log(`[Agent] WebSocket: ws://${config.host}:${config.port}/ws`);
  console.log('[Agent] Press Ctrl+C to stop');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[Agent] Shutting down...');

    await feishuChannel.disconnect();
    await wsChannel.disconnect();
    await sshChannel.disconnect();

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
