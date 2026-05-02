import type { Channel, ChannelCapabilities, OutgoingMessage } from '../types';
import type { Router } from '../../core/router';
import type { SessionManager } from '../../core/session';
import type { SessionBindingStore } from '../../core/session-binding';
import type { EventBus } from '../../core/event';
import type { Context } from 'hono';
import { resolveInstallationToken, verifyWebhookSignature, parseGitHubEvent, type GitHubAuthConfig } from './auth';
import { ConfigManager } from '../../core/config';

interface GitHubEvent {
  owner: string;
  repo: string;
  issueNumber: number;
  text: string;
  userId: string;
}

export class GitHubChannel implements Channel {
  readonly type = 'github';
  readonly name = 'GitHub Webhook';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    cards: false,
    images: false,
    files: false,
    richText: true,
    cardActions: false,
  };

  private router: Router;
  private sessionManager: SessionManager;
  private sessionBinding: SessionBindingStore;
  private eventBus: EventBus;
  private authConfig: GitHubAuthConfig;
  private webhookSecret: string;

  constructor(
    router: Router,
    sessionManager: SessionManager,
    sessionBinding: SessionBindingStore,
    eventBus: EventBus,
    authConfig: GitHubAuthConfig,
    webhookSecret: string,
  ) {
    this.router = router;
    this.sessionManager = sessionManager;
    this.sessionBinding = sessionBinding;
    this.eventBus = eventBus;
    this.authConfig = authConfig;
    this.webhookSecret = webhookSecret;
  }

  async connect(): Promise<void> {
    if (!this.webhookSecret) {
      console.warn('[GitHub] Webhook secret not configured, signature verification disabled');
    }
    console.log('[GitHub] Channel ready');
  }

  async disconnect(): Promise<void> {
    console.log('[GitHub] Disconnected');
  }

  isConnected(): boolean {
    return true;
  }

  handleEvent(_event: unknown): Promise<void> {
    return Promise.resolve();
  }

  async send(sessionId: string, message: OutgoingMessage): Promise<void> {
    // Parse sessionId: "github:<owner>/<repo>#<issueNumber>"
    const parts = sessionId.match(/^github:(.+?)\/(.+?)#(\d+)$/);
    if (!parts) return;

    const [, owner, repo, issueNum] = parts;

    try {
      const auth = await resolveInstallationToken(this.authConfig, owner, repo);
      const commentBody = message.text;

      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${issueNum}/comments`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${auth.token}`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.github+json',
            'User-Agent': 'vibe-coding-agent',
          },
          body: JSON.stringify({ body: commentBody }),
        },
      );

      if (!res.ok) {
        console.error(`[GitHub] Failed to post comment: ${res.status} ${await res.text()}`);
      }
    } catch (error) {
      console.error('[GitHub] send error:', error);
    }
  }

  // ===== Webhook Handler =====

  async handleWebhook(c: Context): Promise<Response> {
    try {
      const body = await c.req.text();
      const signature = c.req.header('x-hub-signature-256') ?? '';
      const eventType = c.req.header('x-github-event') ?? '';
      const deliveryId = c.req.header('x-github-delivery') ?? '';

      // Verify signature
      if (this.webhookSecret) {
        const valid = await verifyWebhookSignature(this.webhookSecret, body, signature);
        if (!valid) {
          return c.json({ error: 'Invalid signature' }, 403);
        }
      }

      const payload = JSON.parse(body);
      const parsed = parseGitHubEvent(eventType, payload);
      if (!parsed) {
        return c.json({ success: true, ignored: true, reason: `unhandled event: ${eventType}/${payload.action}` });
      }

      console.log(`[GitHub] ${eventType} from ${parsed.owner}/${parsed.repo}#${parsed.issueNumber}`);

      await this.processEvent(parsed as GitHubEvent);
      return c.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[GitHub] Webhook error:', msg);
      return c.json({ error: msg }, 500);
    }
  }

  private async processEvent(event: GitHubEvent): Promise<void> {
    const dmId = `github:${event.owner}/${event.repo}#${event.issueNumber}`;

    // Get or create session
    const sessionId = await this.sessionBinding.getOrCreate('github', dmId, async () => {
      const cm = new ConfigManager();
      const defaultAgent = cm.get('default_agent') || 'echo';
      const session = await this.sessionManager.create(
        dmId,
        defaultAgent,
        { workingDir: '/projects/sandbox' },
        dmId,
        'github',
      );
      return session.id;
    });

    // Route to agent
    await this.router.route({
      channel: this.type,
      channelId: dmId,
      sessionId,
      userId: event.userId,
      role: 'user',
      content: event.text,
      timestamp: new Date(),
    });
  }
}
