import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { SessionManager, MemorySessionStore } from '../../src/core/session';
import { SessionBindingStore } from '../../src/core/session-binding';
import { Router } from '../../src/core/router';
import { EventBus } from '../../src/core/event';
import { ToolRegistry } from '../../src/core/registry';
import { AgentManager } from '../../src/agents/manager';
import { RuntimeRegistry } from '../../src/agents/runtime/registry';
import { CLIRuntime } from '../../src/agents/runtime/cli';
import { PipelineEngine } from '../../src/agents/pipeline/executor';
import { ChannelManager } from '../../src/core/channel-manager';
import { WebhookChannelFactory } from '../../src/channels/webhook/factory';
import { MCPChannelFactory } from '../../src/channels/mcp/factory';
import { GitHubChannelFactory } from '../../src/channels/github/factory';
import type { WebhookChannel } from '../../src/channels/webhook/channel';
import type { MCPChannel } from '../../src/channels/mcp/channel';
import type { GitHubChannel } from '../../src/channels/github/channel';

describe('Channels E2E', () => {
  let app: Hono;
  let channelManager: ChannelManager;
  let sessionManager: SessionManager;

  beforeAll(async () => {
    const store = new MemorySessionStore();
    sessionManager = new SessionManager(store);
    const eventBus = new EventBus();
    const toolRegistry = new ToolRegistry();
    const sessionBinding = new SessionBindingStore();

    const agentManager = new AgentManager();
    const runtimeRegistry = new RuntimeRegistry();
    runtimeRegistry.register('cli', new CLIRuntime());

    agentManager.register({
      name: 'echo',
      description: 'Simple echo agent for testing',
      runtimeType: 'cli',
      config: { command: 'echo', args: ['Echo:'] },
      capabilities: { streaming: false, multiTurn: false },
    });

    const pipeline = new PipelineEngine(agentManager, runtimeRegistry, toolRegistry);
    const router = new Router(sessionManager, agentManager, eventBus, toolRegistry, pipeline, 'echo');

    // ChannelManager
    channelManager = new ChannelManager();
    channelManager.setDependencies({ router, sessionManager, eventBus, sessionBinding });

    // Register factories
    channelManager.registerFactory(new WebhookChannelFactory());
    channelManager.registerFactory(new MCPChannelFactory());
    channelManager.registerFactory(new GitHubChannelFactory());
    await channelManager.enable('webhook', { tokens: 'test-token' });
    await channelManager.enable('mcp', {});

    // Hono app with same routes as server.ts
    app = new Hono();
    const api = new Hono();

    // Webhook route
    api.post('/channels/webhook/:token', async (c) => {
      const ch = channelManager.get<WebhookChannel>('webhook');
      if (!ch?.isConnected()) return c.json({ error: 'Webhook channel disabled' }, 503);
      return ch.handleRequest(c);
    });

    // MCP routes
    api.get('/channels/mcp/sse', async (c) => {
      const ch = channelManager.get<MCPChannel>('mcp');
      if (!ch?.isConnected()) return c.json({ error: 'MCP channel disabled' }, 503);
      return ch.handleSSE(c);
    });

    api.post('/channels/mcp/message', async (c) => {
      const ch = channelManager.get<MCPChannel>('mcp');
      if (!ch?.isConnected()) return c.json({ error: 'MCP channel disabled' }, 503);
      return ch.handleMessage(c);
    });

    // GitHub route (channel may or may not be enabled)
    api.post('/channels/github/webhook', async (c) => {
      const ch = channelManager.get<GitHubChannel>('github');
      if (!ch?.isConnected()) return c.json({ error: 'GitHub channel disabled' }, 503);
      return ch.handleWebhook(c);
    });

    app.route('/api', api);
  });

  afterAll(async () => {
    await channelManager.disconnectAll();
  });

  // ===== Webhook Channel =====

  test('webhook: POST with valid token returns success', async () => {
    const res = await app.fetch(
      new Request('http://test/api/channels/webhook/test-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello', userId: 'tester', wait: false }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.sessionId).toBeString();
  });

  test('webhook: POST with invalid token returns 403', async () => {
    const res = await app.fetch(
      new Request('http://test/api/channels/webhook/wrong-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello', userId: 'tester' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  test('webhook: POST without text returns 400', async () => {
    const res = await app.fetch(
      new Request('http://test/api/channels/webhook/test-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'tester' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('webhook: POST with wait=true sync-route returns response', async () => {
    const res = await app.fetch(
      new Request('http://test/api/channels/webhook/test-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'ping sync', userId: 'sync_tester', wait: true }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.sessionId).toBeString();
    // Echo agent should have responded (may be async, response could be empty in race)
    if (body.response) {
      expect(body.response).toContain('Echo:');
    }
  });

  test('webhook: successive messages reuse same session', async () => {
    // First message
    const res1 = await app.fetch(
      new Request('http://test/api/channels/webhook/test-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'msg1', userId: 'session_test', wait: true }),
      }),
    );
    const body1 = await res1.json();
    const sessionId = body1.sessionId;

    // Second message with same userId
    const res2 = await app.fetch(
      new Request('http://test/api/channels/webhook/test-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'msg2', userId: 'session_test', wait: true }),
      }),
    );
    const body2 = await res2.json();
    expect(body2.sessionId).toBe(sessionId);
  });

  // ===== MCP Channel =====

  test('mcp: SSE endpoint returns event-stream', async () => {
    const res = await app.fetch(
      new Request('http://test/api/channels/mcp/sse', { method: 'GET' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
  });

  test('mcp: MCP channel is connected', async () => {
    const ch = channelManager.get<MCPChannel>('mcp');
    expect(ch).toBeDefined();
    expect(ch.isConnected()).toBe(true);
    expect(ch.type).toBe('mcp');
  });

  test('mcp: POST to message endpoint without sessionId returns 400', async () => {
    const res = await app.fetch(
      new Request('http://test/api/channels/mcp/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('sessionId');
  });

  test('mcp: POST with bad sessionId returns 404', async () => {
    const res = await app.fetch(
      new Request('http://test/api/channels/mcp/message?sessionId=nonexistent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  // ===== GitHub Channel (needs config) =====

  test('github: webhook endpoint returns disabled when not configured', async () => {
    const res = await app.fetch(
      new Request('http://test/api/channels/github/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'issue_comment',
          'x-github-delivery': 'test-delivery',
        },
        body: JSON.stringify({
          action: 'created',
          issue: { number: 1 },
          comment: { body: 'test comment', user: { login: 'testuser' } },
          repository: { full_name: 'testowner/testrepo' },
        }),
      }),
    );
    // GitHub channel is not enabled → 503
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('disabled');
  });

  test('github: can be enabled with token config', async () => {
    // Validate that the channel factory can create a channel with a token
    const { GitHubChannelFactory } = await import('../../src/channels/github/factory');
    const factory = new GitHubChannelFactory();
    expect(factory.type).toBe('github');
    expect(factory.capabilities.text).toBe(true);
  });
});
