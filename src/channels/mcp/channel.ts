import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Channel, ChannelCapabilities, OutgoingMessage } from '../types';
import type { Router } from '../../core/router';
import type { SessionManager } from '../../core/session';
import type { SessionBindingStore } from '../../core/session-binding';
import type { EventBus } from '../../core/event';
import type { Context } from 'hono';
import { z } from 'zod';

/**
 * Custom SSE transport for MCP, compatible with Hono.
 * Each SSE connection gets one transport instance, identified by a session ID.
 */
class HonoSSETransport implements Transport {
  private controller: ReadableStreamDefaultController | null = null;
  private _onclose: (() => void) | undefined;
  private _onerror: ((error: Error) => void) | undefined;
  private _onmessage: ((message: any) => void) | undefined;
  private encoder = new TextEncoder();
  sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  setController(controller: ReadableStreamDefaultController): void {
    this.controller = controller;
  }

  async start(): Promise<void> {
    // No-op: transport started when controller is set
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.controller) return;
    try {
      this.controller.enqueue(this.encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
    } catch {
      // Stream closed
    }
  }

  async close(): Promise<void> {
    this._onclose?.();
    this.controller = null;
  }

  get onclose(): (() => void) | undefined { return this._onclose; }
  set onclose(fn: (() => void) | undefined) { this._onclose = fn; }

  get onerror(): ((error: Error) => void) | undefined { return this._onerror; }
  set onerror(fn: ((error: Error) => void) | undefined) { this._onerror = fn; }

  get onmessage(): ((message: any) => void) | undefined { return this._onmessage; }
  set onmessage(fn: ((message: any) => void) | undefined) { this._onmessage = fn; }

  /** Called when a POST message arrives */
  handleMessage(message: any): void {
    this._onmessage?.(message);
  }
}

export class MCPChannel implements Channel {
  readonly type = 'mcp';
  readonly name = 'MCP Server';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    cards: false,
    images: false,
    files: false,
    richText: false,
    cardActions: false,
  };

  private server: McpServer;
  private router: Router;
  private sessionManager: SessionManager;
  private sessionBinding: SessionBindingStore;
  private eventBus: EventBus;
  private transports = new Map<string, HonoSSETransport>();

  constructor(
    router: Router,
    sessionManager: SessionManager,
    sessionBinding: SessionBindingStore,
    eventBus: EventBus,
  ) {
    this.router = router;
    this.sessionManager = sessionManager;
    this.sessionBinding = sessionBinding;
    this.eventBus = eventBus;

    this.server = new McpServer({
      name: 'vibe-coding-agent',
      version: '0.1.0',
    });

    this.registerTools();
  }

  async connect(): Promise<void> {
    console.log('[MCP] Channel ready');
  }

  async disconnect(): Promise<void> {
    for (const t of this.transports.values()) {
      await t.close();
    }
    this.transports.clear();
    console.log('[MCP] Disconnected');
  }

  isConnected(): boolean {
    return true;
  }

  handleEvent(_event: unknown): Promise<void> {
    return Promise.resolve();
  }

  async send(_sessionId: string, _message: OutgoingMessage): Promise<void> {
    // MCP client receives responses via JSON-RPC tool result
  }

  // ===== MCP Tool Registration =====

  private registerTools(): void {
    // Chat tool: send a message to the agent
    this.server.tool(
      'chat',
      'Send a message to an AI agent and get a response',
      {
        message: z.string().describe('The message to send'),
        agent: z.string().optional().describe('Agent name (default: configured default)'),
        sessionId: z.string().optional().describe('Existing session ID to continue (optional)'),
      },
      async (args) => {
        try {
          const result = await this.handleChat(args.message, args.agent, args.sessionId);
          return { content: [{ type: 'text' as const, text: result.text }] };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
        }
      },
    );

    // List agents
    this.server.tool(
      'list_agents',
      'List all available AI agents',
      {},
      async () => {
        const agents = this.router.getAvailableAgents();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(agents, null, 2) }],
        };
      },
    );

    // Create session
    this.server.tool(
      'create_session',
      'Create a new session',
      {
        agent: z.string().optional().describe('Agent name for the new session'),
      },
      async (args) => {
        const agent = args.agent ?? this.router.getDefaultAgent();
        const session = await this.sessionManager.create('mcp_user', agent, { workingDir: '/projects/sandbox' }, undefined, 'mcp');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ sessionId: session.id, agentType: session.agentType }, null, 2) }],
        };
      },
    );

    // Get session info
    this.server.tool(
      'get_session_info',
      'Get information about a session',
      {
        sessionId: z.string().describe('Session ID to query'),
      },
      async (args) => {
        const session = await this.sessionManager.get(args.sessionId);
        if (!session) {
          return { content: [{ type: 'text' as const, text: 'Session not found' }], isError: true };
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            id: session.id,
            agentType: session.agentType,
            state: session.state,
            messageCount: session.messages.length,
            workingDir: session.context?.workingDir,
            createdAt: session.createdAt,
          }, null, 2) }],
        };
      },
    );
  }

  // ===== Chat Handler =====

  private async handleChat(
    message: string,
    agentName?: string,
    sessionId?: string,
  ): Promise<{ text: string; sessionId: string }> {
    const userId = 'mcp_user';
    const agent = agentName ?? this.router.getDefaultAgent();

    // Get or create session
    const sid = await this.sessionBinding.getOrCreate('mcp', 'default', async () => {
      const session = await this.sessionManager.create(userId, agent, { workingDir: '/projects/sandbox' }, sessionId, 'mcp');
      return session.id;
    });

    // Wait for response
    const responsePromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 120000);
      const unsub = this.eventBus.subscribeSession(sid, (event) => {
        if (event.type === 'agent.response') {
          clearTimeout(timeout);
          const data = event.data as { content?: string };
          resolve(data.content ?? '');
          unsub();
        } else if (event.type === 'agent.error') {
          clearTimeout(timeout);
          const data = event.data as { error?: string };
          reject(new Error(data.error ?? 'agent error'));
          unsub();
        }
      });
    });

    // Route the message
    await this.router.route({
      channel: this.type,
      channelId: userId,
      sessionId: sid,
      userId,
      role: 'user',
      content: message,
      timestamp: new Date(),
    });

    const text = await responsePromise;
    return { text, sessionId: sid };
  }

  // ===== SSE Transport =====

  async handleSSE(c: Context): Promise<Response> {
    const transportId = crypto.randomUUID();
    const transport = new HonoSSETransport(transportId);

    const stream = new ReadableStream({
      start: (controller) => {
        transport.setController(controller);

        // Connect McpServer to this transport
        this.server.connect(transport).catch((err) => {
          console.error('[MCP] Server connect error:', err);
        });

        // Store transport
        this.transports.set(transportId, transport);

        // Send endpoint event with the message endpoint URL
        const endpointJson = JSON.stringify({ sessionId: transportId });
        try {
          controller.enqueue(new TextEncoder().encode(`event: endpoint\ndata: /api/channels/mcp/message?sessionId=${transportId}\n\n`));
        } catch {
          // ignore
        }

        transport.onclose = () => {
          this.transports.delete(transportId);
        };

        c.req.raw.signal.addEventListener('abort', () => {
          this.transports.delete(transportId);
          controller.close();
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
  }

  async handleMessage(c: Context): Promise<Response> {
    const sessionId = c.req.query('sessionId');

    if (!sessionId) {
      return c.json({ error: 'sessionId query parameter required' }, 400);
    }

    const transport = this.transports.get(sessionId);
    if (!transport) {
      return c.json({ error: 'No SSE connection for this session' }, 404);
    }

    try {
      const message = await c.req.json() as JSONRPCMessage;
      transport.handleMessage(message);
      return c.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: msg }, 400);
    }
  }
}
