import type { Channel, ChannelCapabilities, OutgoingMessage } from '../types';
import type { Router } from '../../core/router';
import type { SessionManager } from '../../core/session';
import type { SessionBindingStore } from '../../core/session-binding';
import type { EventBus } from '../../core/event';
import type { Context } from 'hono';

export class WebhookChannel implements Channel {
  readonly type = 'webhook';
  readonly name = 'Webhook API';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    cards: false,
    images: false,
    files: false,
    richText: false,
    cardActions: false,
  };

  private tokens: Set<string>;
  private router: Router;
  private sessionManager: SessionManager;
  private sessionBinding: SessionBindingStore;
  private eventBus: EventBus;

  constructor(
    router: Router,
    sessionManager: SessionManager,
    sessionBinding: SessionBindingStore,
    eventBus: EventBus,
    tokens: string[],
  ) {
    this.router = router;
    this.sessionManager = sessionManager;
    this.sessionBinding = sessionBinding;
    this.eventBus = eventBus;
    this.tokens = new Set(tokens.filter(Boolean));
  }

  async connect(): Promise<void> {
    console.log('[Webhook] Channel ready');
  }

  async disconnect(): Promise<void> {
    console.log('[Webhook] Disconnected');
  }

  isConnected(): boolean {
    return true;
  }

  handleEvent(_event: unknown): Promise<void> {
    return Promise.resolve();
  }

  async send(_sessionId: string, _message: OutgoingMessage): Promise<void> {
    // Webhook is pull-based; no active push to clients
  }

  // ===== HTTP Handler =====

  async handleRequest(c: Context): Promise<Response> {
    const token = c.req.param('token') ?? '';
    if (!token) return c.json({ error: 'Token required' }, 400);

    // Validate token
    if (this.tokens.size > 0 && !this.tokens.has(token) && !this.tokens.has('*')) {
      return c.json({ error: 'Invalid token' }, 403);
    }

    try {
      const body = (await c.req.json()) as {
        text: string;
        userId?: string;
        sessionId?: string;
        wait?: boolean;
        agent?: string;
      };

      if (!body.text?.trim()) {
        return c.json({ error: 'text is required' }, 400);
      }

      const userId = body.userId ?? `webhook_${token}`;

      // Get or create session via binding
      const sessionId = await this.sessionBinding.getOrCreate('webhook', userId, async () => {
        const agent = body.agent ?? this.router.getDefaultAgent();
        const session = await this.sessionManager.create(
          userId,
          agent,
          { workingDir: '/projects/sandbox' },
          body.sessionId,
          'webhook',
        );
        return session.id;
      });

      if (body.wait) {
        // Synchronous: wait for response
        return this.routeAndWait(c, sessionId, userId, body.text);
      }

      // Fire-and-forget
      await this.router.route({
        channel: this.type,
        channelId: userId,
        sessionId,
        userId,
        role: 'user',
        content: body.text.trim(),
        timestamp: new Date(),
      });

      return c.json({ success: true, sessionId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: msg }, 500);
    }
  }

  private async routeAndWait(
    c: Context,
    sessionId: string,
    userId: string,
    text: string,
  ): Promise<Response> {
    const timeoutMs = 60000;

    const responsePromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);

      const unsub = this.eventBus.subscribeSession(sessionId, (event) => {
        if (event.type === 'agent.response') {
          clearTimeout(timer);
          const data = event.data as { content?: string };
          resolve(data.content ?? '');
          unsub();
        } else if (event.type === 'agent.error') {
          clearTimeout(timer);
          const data = event.data as { error?: string };
          reject(new Error(data.error ?? 'agent error'));
          unsub();
        }
      });
    });

    try {
      await this.router.route({
        channel: this.type,
        channelId: userId,
        sessionId,
        userId,
        role: 'user',
        content: text.trim(),
        timestamp: new Date(),
      });

      const response = await responsePromise;
      return c.json({ success: true, sessionId, response });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === 'timeout') {
        return c.json({ success: true, sessionId, warning: 'timeout, response will be sent async' });
      }
      return c.json({ error: msg }, 500);
    }
  }
}
