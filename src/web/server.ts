import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Server } from 'bun';
import type { Router } from '../core/router';
import type { ChannelManager } from '../core/channel-manager';
import type { WebSocketChannel } from '../channels/websocket/channel';
import type { BunWebSocket } from '../channels/types';
import type { EventBus } from '../core/event';
import type { SessionManager } from '../core/session';
import { ConfigManager } from '../core/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import QRCode from 'qrcode';
import { startRegistration, getRegistration, subscribeRegistration } from '../channels/feishu-register';

interface ServerConfig {
  port: number;
  host: string;
}

export class WebServer {
  private app: Hono;
  private config: ServerConfig;
  private router: Router;
  private channelManager: ChannelManager;
  private wsChannel: WebSocketChannel;
  private eventBus: EventBus;
  private sessionManager: SessionManager;

  constructor(
    router: Router,
    channelManager: ChannelManager,
    wsChannel: WebSocketChannel,
    eventBus: EventBus,
    sessionManager: SessionManager,
    config: Partial<ServerConfig> = {}
  ) {
    this.app = new Hono();
    this.router = router;
    this.channelManager = channelManager;
    this.wsChannel = wsChannel;
    this.eventBus = eventBus;
    this.sessionManager = sessionManager;
    this.config = {
      port: config.port ?? 3000,
      host: config.host ?? '0.0.0.0',
    };

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use('*', logger());
    this.app.use('*', cors());
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (c) => {
      return c.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        wsConnections: this.wsChannel.getConnectionCount(),
        channels: this.channelManager.listActive().map((ch) => ({
          type: ch.type,
          connected: ch.isConnected(),
        })),
      });
    });

    // Feishu webhook (deprecated — Sidecar handles all Feishu events)
    this.app.post('/feishu/webhook', async (c) => {
      try {
        const body = await c.req.json();
        const feishu = this.channelManager.get('feishu');
        if (feishu) {
          await feishu.handleEvent(body);
        }
        return c.json({ code: 0 });
      } catch (error) {
        console.error('[Feishu] Webhook error:', error);
        return c.json({ code: 1, message: 'Internal error' }, 500);
      }
    });

    // Web UI
    this.app.get('/', (c) => {
      try {
        const htmlPath = join(process.cwd(), 'src/web/ui/index.html');
        const html = readFileSync(htmlPath, 'utf-8');
        return c.html(html);
      } catch {
        return c.html('<h1>AI Coding Agent</h1><p>UI not found</p>');
      }
    });

    // API routes
    const api = new Hono();

    // Session management
    api.get('/sessions', async (c) => {
      const userId = c.req.query('userId');
      const sessions = userId
        ? await this.sessionManager.listByUserId(userId)
        : await this.sessionManager.listAll();
      const result = sessions.map((s) => ({
        id: s.id,
        userId: s.userId,
        agentType: s.agentType,
        state: s.state,
        pinned: s.pinned ?? false,
        messageCount: s.messages.length,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));
      return c.json({ sessions: result });
    });

    api.get('/sessions/:id', async (c) => {
      const id = c.req.param('id');
      const session = await this.sessionManager.get(id);
      if (!session) return c.json({ error: 'Session not found' }, 404);
      return c.json({
        id: session.id,
        userId: session.userId,
        agentType: session.agentType,
        state: session.state,
        pinned: session.pinned ?? false,
        context: session.context,
        messages: session.messages.map((m) => ({
          role: m.role,
          content: m.content,
          channel: m.channel,
          timestamp: m.timestamp,
        })),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    });

    api.post('/sessions', async (c) => {
      const body = await c.req.json() as { userId?: string; agentType?: string };
      const userId = body.userId ?? 'default';
      const agentType = body.agentType ?? this.router.getDefaultAgent();
      const session = await this.sessionManager.create(userId, agentType, { workingDir: '/projects/sandbox' });
      return c.json({
        id: session.id,
        userId: session.userId,
        agentType: session.agentType,
        createdAt: session.createdAt,
      }, 201);
    });

    api.delete('/sessions/:id', async (c) => {
      const id = c.req.param('id');
      await this.sessionManager.close(id);
      return c.json({ success: true });
    });

    api.post('/sessions/:id/pin', async (c) => {
      const id = c.req.param('id');
      const session = await this.sessionManager.pin(id);
      return c.json({ id: session.id, pinned: true });
    });

    api.post('/sessions/:id/unpin', async (c) => {
      const id = c.req.param('id');
      const session = await this.sessionManager.unpin(id);
      return c.json({ id: session.id, pinned: false });
    });

    api.post('/sessions/:id/switch-agent', async (c) => {
      const id = c.req.param('id');
      const body = await c.req.json() as { agentType: string };
      if (!body.agentType) return c.json({ error: 'agentType required' }, 400);
      const session = await this.sessionManager.switchAgent(id, body.agentType);
      return c.json({
        id: session.id,
        agentType: session.agentType,
      });
    });

    // Agent status
    api.get('/agents', (c) => {
      return c.json({ agents: this.router.getAvailableAgents() });
    });

    // Tools
    api.get('/tools', (c) => {
      return c.json({ tools: ['shell', 'git', 'file'] });
    });

    // Config management
    api.get('/config', (c) => {
      try {
        const cm = new ConfigManager();
        const entries = cm.getAllEntries();
        const system = cm.getSystemEntries();
        return c.json({
          entries,
          system: system.slice(0, 20),
        });
      } catch (error) {
        console.error('[Config] Get error:', error);
        return c.json({ error: 'Failed to read config' }, 500);
      }
    });

    api.get('/config/:key', (c) => {
      try {
        const cm = new ConfigManager();
        const key = c.req.param('key');
        const value = cm.get(key);
        const masked = cm.getMasked(key);
        return c.json({ key, value: value ?? '', masked });
      } catch (error) {
        return c.json({ error: 'Failed to read config' }, 500);
      }
    });

    api.post('/config', async (c) => {
      try {
        const body = await c.req.json() as { key: string; value: string };
        if (!body.key) {
          return c.json({ error: 'Missing key' }, 400);
        }
        const cm = new ConfigManager();
        cm.set(body.key, body.value ?? '');
        return c.json({ success: true, key: body.key });
      } catch (error) {
        console.error('[Config] Set error:', error);
        return c.json({ error: 'Failed to save config' }, 500);
      }
    });

    api.post('/config/batch', async (c) => {
      try {
        const body = await c.req.json() as Record<string, string>;
        const cm = new ConfigManager();
        for (const [key, value] of Object.entries(body)) {
          cm.set(key, value);
        }
        return c.json({ success: true, keys: Object.keys(body) });
      } catch (error) {
        console.error('[Config] Batch set error:', error);
        return c.json({ error: 'Failed to save config' }, 500);
      }
    });

    api.post('/config/reload', (c) => {
      try {
        const cm = new ConfigManager();
        cm.reloadEnvFromDb();
        return c.json({ success: true, message: 'Config reloaded' });
      } catch (error) {
        return c.json({ error: 'Failed to reload config' }, 500);
      }
    });

    api.post('/config/reset', (c) => {
      try {
        const cm = new ConfigManager();
        cm.reset();
        return c.json({ success: true, message: 'Config reset to defaults' });
      } catch (error) {
        return c.json({ error: 'Failed to reset config' }, 500);
      }
    });

    // Feishu QR code and status
    api.get('/feishu/qrcode', async (c) => {
      try {
        const cm = new ConfigManager();
        const appId = cm.get('feishu_app_id');
        if (!appId) {
          return c.json({ error: 'Feishu App ID not configured' }, 400);
        }

        const shareUrl = `https://applink.feishu.cn/client/mini_program/open?appId=${appId}`;

        const svg = await QRCode.toString(shareUrl, {
          type: 'svg',
          width: 200,
          margin: 2,
          color: {
            dark: '#00d9ff',
            light: '#1a1a2e',
          },
        });

        return c.body(svg, 200, { 'Content-Type': 'image/svg+xml' });
      } catch (error) {
        console.error('[Feishu] QR code generation error:', error);
        return c.json({ error: 'Failed to generate QR code' }, 500);
      }
    });

    api.get('/feishu/status', async (c) => {
      try {
        const cm = new ConfigManager();
        const appId = cm.get('feishu_app_id');
        const appSecret = cm.get('feishu_app_secret');

        if (!appId || !appSecret) {
          return c.json({
            configured: false,
            appId: appId ? `${appId.slice(0, 6)}...` : null,
            connected: false,
            message: 'App ID or App Secret not configured',
          });
        }

        const response = await fetch(
          'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
          }
        );

        const data = await response.json() as { code: number; msg?: string };
        const connected = data.code === 0;

        return c.json({
          configured: true,
          appId: `${appId.slice(0, 6)}...`,
          connected,
          message: connected ? 'Connection successful' : `Connection failed: ${data.msg}`,
        });
      } catch (error) {
        return c.json({
          configured: true,
          connected: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    api.post('/feishu/test', async (c) => {
      try {
        const cm = new ConfigManager();
        const appId = cm.get('feishu_app_id');
        const appSecret = cm.get('feishu_app_secret');

        if (!appId || !appSecret) {
          return c.json({ success: false, message: 'App ID or App Secret not configured' }, 400);
        }

        const response = await fetch(
          'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
          }
        );

        const data = await response.json() as { code: number; tenant_access_token?: string; msg?: string };

        if (data.code !== 0) {
          return c.json({ success: false, message: data.msg || 'Failed to get tenant token' }, 400);
        }

        return c.json({
          success: true,
          message: 'Connection successful',
          tokenPreview: data.tenant_access_token ? `${data.tenant_access_token.slice(0, 10)}...` : null,
        });
      } catch (error) {
        return c.json({
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        }, 500);
      }
    });

    // Feishu bot registration via QR code (device-code flow)
    api.post('/feishu/register/init', async (c) => {
      try {
        const reg = await startRegistration();
        return c.json({
          success: true,
          deviceCode: reg.deviceCode,
          qrUrl: reg.qrUrl,
          expiresIn: reg.expiresIn,
        });
      } catch (error) {
        console.error('[Feishu] Registration init error:', error);
        return c.json({
          success: false,
          message: error instanceof Error ? error.message : 'Failed to start registration',
        }, 500);
      }
    });

    api.get('/feishu/register/:deviceCode', (c) => {
      try {
        const deviceCode = c.req.param('deviceCode');
        const reg = getRegistration(deviceCode);

        if (!reg) {
          return c.json({ success: false, message: 'Registration not found' }, 404);
        }

        return c.json({
          success: true,
          status: reg.status,
          appId: reg.appId,
          appSecret: reg.appSecret,
          domain: reg.domain,
          error: reg.error,
        });
      } catch (error) {
        return c.json({
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        }, 500);
      }
    });

    // Feishu registration SSE stream
    api.get('/feishu/register/:deviceCode/sse', async (c) => {
      const deviceCode = c.req.param('deviceCode');
      const reg = getRegistration(deviceCode);
      if (!reg) {
        return c.json({ success: false, message: 'Registration not found' }, 404);
      }

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          const send = (data: unknown) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            } catch {}
          };

          send({
            status: reg.status,
            appId: reg.appId,
            appSecret: reg.appSecret,
            domain: reg.domain,
            error: reg.error,
          });

          if (reg.status !== 'pending') {
            send({ done: true });
            controller.close();
            return;
          }

          const unsubscribe = subscribeRegistration(deviceCode, (updated) => {
            send({
              status: updated.status,
              appId: updated.appId,
              appSecret: updated.appSecret,
              domain: updated.domain,
              error: updated.error,
            });
            if (updated.status !== 'pending') {
              send({ done: true });
              try { controller.close(); } catch {}
            }
          });

          const heartbeat = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(':heartbeat\n\n'));
            } catch {
              clearInterval(heartbeat);
            }
          }, 15000);

          c.req.raw.signal.addEventListener('abort', () => {
            clearInterval(heartbeat);
            unsubscribe();
          });
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    });

    // Chat message via HTTP POST (for SSE-based clients)
    api.post('/chat/:sessionId', async (c) => {
      try {
        const sessionId = c.req.param('sessionId');
        const body = await c.req.json() as { message: string; userId?: string };
        if (!body.message?.trim()) {
          return c.json({ error: 'Message is required' }, 400);
        }

        await this.router.route({
          sessionId,
          channelId: sessionId,
          userId: body.userId ?? sessionId,
          role: 'user',
          content: body.message.trim(),
          channel: 'websocket',
          timestamp: new Date(),
        });
        return c.json({ success: true });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('[Chat] POST error:', errMsg);
        return c.json({ error: errMsg }, 500);
      }
    });

    // Cancel running pipeline
    api.post('/chat/:sessionId/cancel', async (c) => {
      const sessionId = c.req.param('sessionId');
      this.router.cancel(sessionId);
      return c.json({ success: true });
    });

    // Check if a pipeline is running
    api.get('/chat/:sessionId/running', async (c) => {
      const sessionId = c.req.param('sessionId');
      return c.json({ running: this.router.isRunning(sessionId) });
    });

    // Chat SSE stream
    api.get('/chat/:sessionId/sse', async (c) => {
      const sessionId = c.req.param('sessionId');

      const stream = new ReadableStream({
        start: (controller) => {
          const encoder = new TextEncoder();

          const send = (data: unknown) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            } catch {}
          };

          const unsubscribe = this.eventBus.subscribeSession(sessionId, (event) => {
            if (event.type === 'agent.thinking') {
              send({
                type: 'thinking',
                content: (event.data as any)?.content ?? '',
                timestamp: event.timestamp.toISOString(),
              });
            } else if (event.type === 'agent.tool_executing') {
              send({
                type: 'tool_executing',
                toolName: (event.data as any)?.toolName ?? '',
                timestamp: event.timestamp.toISOString(),
              });
            } else if (event.type === 'agent.stream_chunk') {
              send({
                type: 'stream_chunk',
                content: (event.data as any)?.content ?? '',
                timestamp: event.timestamp.toISOString(),
              });
            } else if (event.type === 'agent.response') {
              const data = event.data as { content?: string };
              if (data.content) {
                send({
                  type: 'response',
                  content: data.content,
                  timestamp: event.timestamp.toISOString(),
                });
              }
            } else if (event.type === 'agent.error') {
              send({
                type: 'error',
                content: event.data,
                timestamp: event.timestamp.toISOString(),
              });
            }
          });

          const heartbeat = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(':heartbeat\n\n'));
            } catch {
              clearInterval(heartbeat);
            }
          }, 15000);

          c.req.raw.signal.addEventListener('abort', () => {
            clearInterval(heartbeat);
            unsubscribe();
          });
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    });

    this.app.route('/api', api);

    this.app.notFound((c) => {
      return c.json({ error: 'Not found' }, 404);
    });
  }

  async start(): Promise<void> {
    const wsChannel = this.wsChannel;

    const server: Server<{ sessionId: string }> = Bun.serve({
      port: this.config.port,
      hostname: this.config.host,
      idleTimeout: 255,
      fetch: async (request) => {
        const url = new URL(request.url);

        if (url.pathname === '/ws') {
          const sessionId = url.searchParams.get('sessionId') || 'default';
          const upgrade = server.upgrade(request, { data: { sessionId } });
          if (upgrade) return;
        }

        return this.app.fetch(request);
      },
      websocket: {
        open(ws) {
          const sessionId = (ws as unknown as { data: { sessionId: string } }).data?.sessionId || 'default';
          console.log(`[WebSocket] New connection, sessionId=${sessionId}`);
          wsChannel.addConnection(sessionId, ws as unknown as BunWebSocket);
        },
        message(ws, data) {
          if (typeof data === 'string') {
            const sessionId = (ws as unknown as { data: { sessionId: string } }).data?.sessionId || 'default';
            wsChannel.handleWSMessage(ws as unknown as BunWebSocket, sessionId, data);
          }
        },
        close(ws) {
          const sessionId = (ws as unknown as { data: { sessionId: string } }).data?.sessionId || 'default';
          wsChannel.removeConnection(sessionId, ws as unknown as BunWebSocket);
        },
      },
    });

    console.log(`[Server] Running on http://${this.config.host}:${this.config.port}`);
    console.log(`[Server] WebSocket available at ws://${this.config.host}:${this.config.port}`);
  }
}
