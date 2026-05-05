import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Server } from 'bun';
import type { Router } from '../core/router';
import type { ChannelManager } from '../core/channel-manager';
import type { WebSocketChannel } from '../channels/websocket/channel';
import type { WebhookChannel } from '../channels/webhook/channel';
import type { GitHubChannel } from '../channels/github/channel';
import type { MCPChannel } from '../channels/mcp/channel';
import type { BunWebSocket } from '../channels/types';
import type { EventBus } from '../core/event';
import type { SessionManager } from '../core/session';
import { ConfigManager } from '../core/config';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import QRCode from 'qrcode';
import { startRegistration, getRegistration, subscribeRegistration } from '../channels/feishu-register';

interface ServerConfig {
  port: number;
  host: string;
}

function friendlyError(err: string): { content: string; suggestion?: string } {
  const lower = err.toLowerCase();
  if (lower.includes('selinux') && lower.includes('relabeling')) {
    return { content: '容器卷挂载权限不足：SELinux 阻止了目录挂载。工作目录需在 $HOME 下，避免使用 /tmp 或系统目录。', suggestion: '检查工作目录路径，确保在用户 home 目录下' };
  }
  if (lower.includes('statfs') || (lower.includes('no such file') && lower.includes('directory'))) {
    return { content: '工作目录不存在。请为会话设置一个有效的工作目录。', suggestion: '在侧栏双击工作目录路径进行修改' };
  }
  if (lower.includes('posix_spawn') || lower.includes('enoent')) {
    const cmd = lower.match(/'([^']+)'/)?.[1] || '';
    return { content: `命令 "${cmd}" 未找到。请确保 ${cmd} 已安装在服务器上，或在配置页设置正确的路径。`, suggestion: cmd ? `安装 ${cmd} 或切换到已安装的 Agent` : undefined };
  }
  if (lower.includes('docker') && lower.includes('path')) {
    return { content: '容器引擎 "docker" 未找到。服务器使用 Podman，请在配置页将 "container_cmd" 设为 "podman"。', suggestion: '前往配置页 → Agent → 设置 container_cmd = podman' };
  }
  if (lower.includes('tool calling exceeded')) {
    return { content: 'Agent 工具调用超过最大轮数。这可能是因为工具执行陷入了循环。', suggestion: '请尝试简化指令或更换 Agent' };
  }
  if (lower.includes('image') && (lower.includes('not found') || lower.includes('pull access'))) {
    return { content: `容器镜像不存在或无权限拉取: ${err}`, suggestion: '在配置页的「容器镜像」管理中拉取所需镜像' };
  }
  return { content: err };
}

function checkDir(path: string | undefined): 'valid' | 'missing' | 'none' {
  if (!path) return 'none';
  try { return existsSync(path) ? 'valid' : 'missing'; } catch { return 'missing'; }
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
        c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        return c.html(html);
      } catch {
        return c.html('<h1>AI Coding Agent</h1><p>UI not found</p>');
      }
    });

    // Config page
    this.app.get('/config', (c) => {
      try {
        const htmlPath = join(process.cwd(), 'src/web/ui/config.html');
        const html = readFileSync(htmlPath, 'utf-8');
        c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        return c.html(html);
      } catch {
        return c.html('<h1>配置页面</h1><p>UI not found</p>');
      }
    });

    // Static UI assets (compiled JS + CSS)
    this.app.get('/ui/*', async (c) => {
      try {
        const filePath = join(process.cwd(), 'dist', c.req.path);
        const file = Bun.file(filePath);
        const exists = await file.exists();
        if (!exists) return c.json({ error: 'Not found' }, 404);
        const ext = filePath.split('.').pop();
        const mime: Record<string, string> = {
          js: 'application/javascript',
          css: 'text/css',
          html: 'text/html',
        };
        return new Response(file, { headers: { 'Content-Type': mime[ext || ''] || 'application/octet-stream' } });
      } catch {
        return c.json({ error: 'Not found' }, 404);
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
        participants: s.participants ?? [],
        workingDir: s.context?.workingDir,
        workingDirStatus: checkDir(s.context?.workingDir),
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
        participants: session.participants ?? [],
        workingDir: session.context?.workingDir,
        workingDirStatus: checkDir(session.context?.workingDir),
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
      const body = await c.req.json() as { userId?: string; agentType?: string; workingDir?: string };
      const userId = body.userId ?? 'default';
      const agentType = body.agentType ?? this.router.getDefaultAgent();
      const cm = new ConfigManager();
      const defaultDir = cm.get('working_dir') || '/projects/sandbox';
      const workingDir = body.workingDir || defaultDir;
      const session = await this.sessionManager.create(userId, agentType, { workingDir });
      return c.json({
        id: session.id,
        userId: session.userId,
        agentType: session.agentType,
        workingDir: session.context?.workingDir,
        workingDirStatus: checkDir(session.context?.workingDir),
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

    // Working directory
    api.get('/sessions/:id/working-dir', async (c) => {
      const id = c.req.param('id');
      const session = await this.sessionManager.get(id);
      if (!session) return c.json({ error: 'Session not found' }, 404);
      return c.json({ workingDir: session.context?.workingDir || '/projects/sandbox' });
    });

    api.post('/sessions/:id/working-dir', async (c) => {
      const id = c.req.param('id');
      const body = await c.req.json() as { workingDir: string };
      if (!body.workingDir?.trim()) return c.json({ error: 'workingDir required' }, 400);
      const session = await this.sessionManager.updateContext(id, { workingDir: body.workingDir.trim() });
      return c.json({ success: true, workingDir: session.context?.workingDir });
    });

    // Agent status
    api.get('/agents', (c) => {
      return c.json({ agents: this.router.getAvailableAgents() });
    });

    api.post('/agents/register', async (c) => {
      try {
        const body = await c.req.json();
        const { name, description, runtimeType, command, args, image, containerCmd } = body;
        if (!name || !command) {
          return c.json({ error: 'name and command are required' }, 400);
        }
        const agent = {
          name,
          description: description || '',
          runtimeType: runtimeType || 'cli',
          config: {
            command,
            args: args || [],
            ...(image ? { container: { image, cmd: containerCmd } } : {}),
          },
          capabilities: {
            streaming: body.streaming ?? false,
            multiTurn: body.multiTurn ?? false,
          },
        };
        this.router.registerAgent(agent);
        return c.json({ success: true, name });
      } catch (err: any) {
        return c.json({ error: err.message }, 400);
      }
    });

    api.post('/agents/:name/unregister', async (c) => {
      const name = c.req.param('name');
      const removed = this.router.unregisterAgent(name);
      if (!removed) {
        return c.json({ error: `Agent '${name}' not found` }, 404);
      }
      return c.json({ success: true });
    });

    // Image management
    api.get('/images', async (c) => {
      try {
        const cm = new ConfigManager();
        const cmd = cm.get('container_cmd') || 'docker';
        const proc = Bun.spawn({
          cmd: [cmd, 'images', '--format', '{{.Repository}}:{{.Tag}}|{{.Size}}|{{.CreatedAt}}|{{.ID}}'],
          stdout: 'pipe', stderr: 'pipe',
        });
        const out = await new Response(proc.stdout).text();
        await proc.exited;
        const images = out.trim().split('\n').filter(Boolean).map(line => {
          const [repo, size, created, id] = line.split('|');
          return { repo: repo || '', size: size || '', created: created || '', id: id || '' };
        });
        return c.json({ images, cmd });
      } catch (err: any) {
        return c.json({ error: err.message, images: [] });
      }
    });

    api.post('/images/pull', async (c) => {
      try {
        const body = await c.req.json() as { image: string };
        if (!body.image?.trim()) return c.json({ error: 'image name required' }, 400);
        const cm = new ConfigManager();
        const cmd = cm.get('container_cmd') || 'docker';
        const proc = Bun.spawn({
          cmd: [cmd, 'pull', body.image.trim()],
          stdout: 'pipe', stderr: 'pipe',
        });
        const out = await new Response(proc.stdout).text();
        const err = await new Response(proc.stderr).text();
        await proc.exited;
        if (proc.exitCode !== 0) {
          return c.json({ error: err || out || 'pull failed' });
        }
        return c.json({ success: true, output: out || err });
      } catch (err: any) {
        return c.json({ error: err.message });
      }
    });

    api.post('/images/:name/remove', async (c) => {
      try {
        const imageName = c.req.param('name');
        const cm = new ConfigManager();
        const cmd = cm.get('container_cmd') || 'docker';
        const proc = Bun.spawn({
          cmd: [cmd, 'rmi', imageName],
          stdout: 'pipe', stderr: 'pipe',
        });
        await proc.exited;
        if (proc.exitCode !== 0) {
          const err = await new Response(proc.stderr).text();
          return c.json({ error: err || 'remove failed' });
        }
        return c.json({ success: true });
      } catch (err: any) {
        return c.json({ error: err.message });
      }
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
              const errData = event.data as any;
              const rawMsg = typeof errData === 'string' ? errData : errData?.error || errData?.message || 'Unknown error';
              const friendly = friendlyError(rawMsg);
              send({
                type: 'error',
                content: friendly.content,
                rawError: rawMsg,
                suggestion: friendly.suggestion,
                timestamp: event.timestamp.toISOString(),
              });
            } else if (event.type === 'agent.container_starting') {
              const d = event.data as any;
              send({
                type: 'container_starting',
                content: d?.image || '',
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

    // Channel-specific API routes
    api.post('/channels/webhook/:token', async (c) => {
      const ch = this.channelManager.get<WebhookChannel>('webhook');
      if (!ch || !ch.isConnected()) return c.json({ error: 'Webhook channel disabled' }, 503);
      return ch.handleRequest(c);
    });

    api.post('/channels/github/webhook', async (c) => {
      const ch = this.channelManager.get<GitHubChannel>('github');
      if (!ch || !ch.isConnected()) return c.json({ error: 'GitHub channel disabled' }, 503);
      return ch.handleWebhook(c);
    });

    api.get('/channels/mcp/sse', async (c) => {
      const ch = this.channelManager.get<MCPChannel>('mcp');
      if (!ch || !ch.isConnected()) return c.json({ error: 'MCP channel disabled' }, 503);
      return ch.handleSSE(c);
    });

    api.post('/channels/mcp/message', async (c) => {
      const ch = this.channelManager.get<MCPChannel>('mcp');
      if (!ch || !ch.isConnected()) return c.json({ error: 'MCP channel disabled' }, 503);
      return ch.handleMessage(c);
    });

    this.app.route('/api', api);
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
