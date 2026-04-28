import type { ChannelType, AgentType, UnifiedMessage } from '../core/types';
import { BaseChannel } from './base';
import type { SessionManager } from '../core/session';
import { SidecarRPC } from '../core/sidecar-rpc';
import * as path from 'path';
import * as os from 'os';

interface FeishuConfig {
  appId: string;
  appSecret: string;
  domain?: 'feishu' | 'lark';
}

type UserMenuState = 'idle' | 'menu' | 'select_agent';

interface UserState {
  state: UserMenuState;
  timer: ReturnType<typeof setTimeout> | null;
}

const MENU_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * SidecarFeishuChannel uses a Go sidecar for Feishu WebSocket connection.
 * The Go sidecar handles synchronous card refresh by returning CardActionTriggerResponse
 * directly to Feishu, while card building logic stays in Node.js.
 */
export class SidecarFeishuChannel extends BaseChannel {
  readonly type: ChannelType = 'feishu';
  readonly name = 'Feishu Bot (Sidecar)';

  private config: FeishuConfig;
  private sessionManager: SessionManager;
  private rpc: SidecarRPC | null = null;
  private userStates = new Map<string, UserState>();
  private hasInteracted = new Set<string>();
  private processedActions = new Set<string>();

  constructor(
    router: import('../core/router').Router,
    sessionManager: SessionManager,
    config: FeishuConfig
  ) {
    super(router);
    this.sessionManager = sessionManager;
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.appId || !this.config.appSecret) {
      console.log('[FeishuSidecar] App ID or Secret not configured, skipping');
      return;
    }

    // Find sidecar binary
    const sidecarPath = this.findSidecarBinary();
    if (!sidecarPath) {
      console.error('[FeishuSidecar] feishu-sidecar binary not found');
      console.error('[FeishuSidecar] Run: cd sidecars/feishu && make build');
      return;
    }

    const domain = this.config.domain === 'lark' ? 'https://open.larksuite.com' : '';

    this.rpc = new SidecarRPC(sidecarPath, [], {
      FEISHU_APP_ID: this.config.appId,
      FEISHU_APP_SECRET: this.config.appSecret,
      FEISHU_DOMAIN: domain,
    });

    // Register RPC method handlers (Go sidecar calls these)
    this.rpc.registerMethod('cardAction', (params: any) => this.handleCardAction(params));

    // Listen to sidecar notifications
    this.rpc.on('message', (params: any) => this.handleSidecarMessage(params));

    await this.rpc.start();
    console.log('[FeishuSidecar] Connected via Go sidecar');
  }

  async disconnect(): Promise<void> {
    if (this.rpc) {
      try {
        await this.rpc.call('disconnect');
      } catch {
        // ignore
      }
      this.rpc.stop();
      this.rpc = null;
    }
    console.log('[FeishuSidecar] Disconnected');
  }

  async handleMessage(_event: unknown): Promise<void> {
    return Promise.resolve();
  }

  async send(sessionId: string, message: string): Promise<void> {
    if (!this.rpc) return;
    try {
      await this.rpc.call('sendMessage', {
        receiveId: sessionId,
        content: message,
        msgType: 'text',
      });
    } catch (error) {
      console.error('[FeishuSidecar] Failed to send message:', error);
    }
  }

  // ========== Sidecar Event Handlers ==========

  private async handleSidecarMessage(params: any): Promise<void> {
    const { userId, content, messageId } = params;
    if (!userId || !content) return;

    console.log(`[FeishuSidecar] Message from ${userId}: ${content.substring(0, 100)}`);
    this.hasInteracted.add(userId);

    const handled = await this.handleCommand(userId, content);
    if (handled) return;

    const unifiedMessage: UnifiedMessage = {
      channel: this.type,
      channelId: userId,
      sessionId: userId,
      userId,
      role: 'user',
      content,
      timestamp: new Date(),
    };

    await this.router.route(unifiedMessage);
  }

  /**
   * Handle card action from sidecar.
   * This MUST return within 3 seconds for synchronous card refresh!
   */
  async handleCardAction(params: any): Promise<{ card?: Record<string, unknown>; toast?: { type: string; content: string } }> {
    const { userId, action, value } = params;
    if (!userId || !action) {
      return {
        card: this.buildMenuCard(this.router.getDefaultAgent()),
        toast: { type: 'error', content: 'Invalid action' },
      };
    }

    // Deduplicate: ignore exact same action within 3s, but still return current card
    const actionToken = `${userId}_${action}_${JSON.stringify(value)}`;
    if (this.processedActions.has(actionToken)) {
      const session = await this.sessionManager.getByUserId(userId);
      const currentAgent = session?.agentType ?? this.router.getDefaultAgent();
      return {
        card: this.buildMenuCard(currentAgent, session?.id),
        toast: { type: 'info', content: '正在处理...' },
      };
    }
    this.processedActions.add(actionToken);
    setTimeout(() => this.processedActions.delete(actionToken), 3000);

    console.log(`[FeishuSidecar] Card action from ${userId}: ${action}`);
    this.hasInteracted.add(userId);

    // Fast path: build card response immediately (must be < 3s)
    // Async work (session changes) happens in background
    switch (action) {
      case 'new_session': {
        // Return a loading card first, then do async work
        setTimeout(() => this.doNewSession(userId), 0);
        return {
          card: this.buildMenuCard(this.router.getDefaultAgent()),
          toast: { type: 'success', content: '已创建新会话' },
        };
      }

      case 'switch_agent': {
        return {
          card: this.buildAgentSelectCard(),
          toast: { type: 'info', content: '请选择 Agent' },
        };
      }

      case 'set_agent': {
        const agentName = value?.agent as AgentType;
        const session = await this.sessionManager.getByUserId(userId);
        const currentAgent = session?.agentType ?? this.router.getDefaultAgent();
        if (!agentName) {
          return {
            card: this.buildMenuCard(currentAgent, session?.id),
            toast: { type: 'error', content: '未知 Agent' },
          };
        }
        setTimeout(() => this.doSetAgent(userId, agentName), 0);
        return {
          card: this.buildMenuCard(agentName, session?.id),
          toast: { type: 'success', content: `已切换至 ${agentName}` },
        };
      }

      case 'info': {
        const session = await this.sessionManager.getByUserId(userId);
        const infoCard = this.buildInfoCard(session);
        return {
          card: infoCard,
          toast: { type: 'info', content: '会话信息' },
        };
      }

      case 'back_to_menu':
      case 'open_menu': {
        this.setUserState(userId, 'menu');
        const session = await this.sessionManager.getByUserId(userId);
        const currentAgent = session?.agentType ?? this.router.getDefaultAgent();
        return {
          card: this.buildMenuCard(currentAgent, session?.id),
          toast: { type: 'info', content: '控制台' },
        };
      }

      default: {
        const session = await this.sessionManager.getByUserId(userId);
        const currentAgent = session?.agentType ?? this.router.getDefaultAgent();
        return {
          card: this.buildMenuCard(currentAgent, session?.id),
          toast: { type: 'warning', content: '未知操作' },
        };
      }
    }
  }

  // ========== Async Side Effects ==========

  private async doNewSession(userId: string): Promise<void> {
    const existing = await this.sessionManager.getByUserId(userId);
    if (existing) {
      await this.sessionManager.close(existing.id).catch(() => {});
    }
    await this.sessionManager.create(
      userId,
      this.router.getDefaultAgent(),
      { workingDir: '/projects/sandbox' },
      userId
    );
  }

  private async doSetAgent(userId: string, agentName: AgentType): Promise<void> {
    const session = await this.sessionManager.getByUserId(userId);
    if (session) {
      await this.sessionManager.switchAgent(session.id, agentName);
    } else {
      await this.sessionManager.create(userId, agentName, { workingDir: '/projects/sandbox' }, userId);
    }
  }

  // ========== Menu State Management (same as FeishuChannel) ==========

  private setUserState(openId: string, state: UserMenuState): void {
    const existing = this.userStates.get(openId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    const timer = state === 'idle'
      ? null
      : setTimeout(() => {
          this.userStates.set(openId, { state: 'idle', timer: null });
        }, MENU_TIMEOUT_MS);
    this.userStates.set(openId, { state, timer });
  }

  private getUserState(openId: string): UserMenuState {
    return this.userStates.get(openId)?.state ?? 'idle';
  }

  private isMenuTrigger(text: string): boolean {
    const triggers = ['菜单', 'menu', 'help', '?', '？'];
    return triggers.includes(text.toLowerCase().trim());
  }

  private async handleCommand(openId: string, text: string): Promise<boolean> {
    const state = this.getUserState(openId);

    if (this.isMenuTrigger(text)) {
      await this.sendMenu(openId);
      return true;
    }

    if (state === 'menu') {
      return await this.handleMenuCommand(openId, text);
    }
    if (state === 'select_agent') {
      return await this.handleAgentSelectCommand(openId, text);
    }

    return false;
  }

  private async handleMenuCommand(openId: string, text: string): Promise<boolean> {
    switch (text.trim()) {
      case '1': {
        const existing = await this.sessionManager.getByUserId(openId);
        if (existing) {
          await this.sessionManager.close(existing.id).catch(() => {});
        }
        const newSession = await this.sessionManager.create(
          openId,
          this.router.getDefaultAgent(),
          { workingDir: '/projects/sandbox' },
          openId
        );
        await this.send(openId, `✅ 已创建新会话\nAgent: ${newSession.agentType}`);
        this.setUserState(openId, 'idle');
        return true;
      }
      case '2':
        await this.sendAgentSelectMenu(openId);
        return true;
      case '3':
        await this.sendSessionInfo(openId);
        this.setUserState(openId, 'idle');
        return true;
      case '0':
      case '取消':
        await this.send(openId, '已取消');
        this.setUserState(openId, 'idle');
        return true;
      default:
        this.setUserState(openId, 'idle');
        return false;
    }
  }

  private async handleAgentSelectCommand(openId: string, text: string): Promise<boolean> {
    const agents = this.router.getAvailableAgents();
    if (text.trim() === '0' || text.trim() === '返回') {
      await this.sendMenu(openId);
      return true;
    }
    const index = parseInt(text.trim(), 10) - 1;
    if (isNaN(index) || index < 0 || index >= agents.length) {
      this.setUserState(openId, 'idle');
      return false;
    }
    const agentName = agents[index].name as AgentType;
    const session = await this.sessionManager.getByUserId(openId);
    if (session) {
      await this.sessionManager.switchAgent(session.id, agentName);
    } else {
      await this.sessionManager.create(openId, agentName, { workingDir: '/projects/sandbox' }, openId);
    }
    await this.send(openId, `✅ 已切换至 ${agentName} Agent`);
    this.setUserState(openId, 'idle');
    return true;
  }

  private async sendMenu(openId: string): Promise<void> {
    const session = await this.sessionManager.getByUserId(openId);
    const currentAgent = session?.agentType ?? this.router.getDefaultAgent();
    const card = this.buildMenuCard(currentAgent, session?.id);
    await this.sendCard(openId, card);
    this.setUserState(openId, 'menu');
  }

  private async sendAgentSelectMenu(openId: string): Promise<void> {
    const card = this.buildAgentSelectCard();
    await this.sendCard(openId, card);
    this.setUserState(openId, 'select_agent');
  }

  private async sendSessionInfo(openId: string): Promise<void> {
    const session = await this.sessionManager.getByUserId(openId);
    if (!session) {
      await this.send(openId, 'ℹ️ 当前没有活跃会话');
      return;
    }
    const infoText =
      'ℹ️ 当前会话信息\n\n' +
      `Session ID: ${session.id}\n` +
      `Agent: ${session.agentType}\n` +
      `消息数: ${session.messages.length}\n` +
      `状态: ${session.state}\n` +
      `创建时间: ${session.createdAt.toLocaleString()}`;
    await this.send(openId, infoText);
  }

  private async sendWelcome(openId: string): Promise<void> {
    const card = this.buildWelcomeCard();
    await this.sendCard(openId, card);
    await this.sendMenu(openId);
  }

  private async sendCard(openId: string, card: Record<string, unknown>): Promise<void> {
    if (!this.rpc) return;
    try {
      await this.rpc.call('sendCardSync', { receiveId: openId, card });
    } catch (error) {
      console.error('[FeishuSidecar] Failed to send card:', error);
    }
  }

  // ========== Card Builders ==========

  private buildMenuCard(currentAgent: string, sessionId?: string): Record<string, unknown> {
    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '🤖 AI Agent 控制台' },
        template: 'blue',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**当前 Agent:** ${currentAgent}${sessionId ? `\n**Session:** ${sessionId.slice(0, 8)}...` : ''}`,
          },
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '🆕 新建会话' },
              type: 'primary',
              value: { action: 'new_session' },
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '🤖 切换 Agent' },
              type: 'default',
              value: { action: 'switch_agent' },
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: 'ℹ️ 会话信息' },
              type: 'default',
              value: { action: 'info' },
            },
          ],
        },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: '_点击按钮即可操作，或直接发送消息对话_',
          },
        },
      ],
    };
  }

  private buildAgentSelectCard(): Record<string, unknown> {
    const agents = this.router.getAvailableAgents();
    const actions = agents.map((agent) => ({
      tag: 'button',
      text: { tag: 'plain_text', content: agent.name },
      type: 'default',
      value: { action: 'set_agent', agent: agent.name },
    }));

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '🤖 切换 Agent' },
        template: 'blue',
      },
      elements: [
        {
          tag: 'action',
          actions: [
            ...actions,
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '🔙 返回' },
              type: 'danger',
              value: { action: 'back_to_menu' },
            },
          ],
        },
      ],
    };
  }

  private buildWelcomeCard(): Record<string, unknown> {
    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '👋 欢迎使用 AI Coding Agent' },
        template: 'blue',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: '我可以帮你：\n• 💬 聊天对话\n• 🛠️ 执行 Shell / Git / File 工具\n• 🤖 切换不同 AI Agent',
          },
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '📋 打开控制台' },
              type: 'primary',
              value: { action: 'open_menu' },
            },
          ],
        },
      ],
    };
  }

  private buildInfoCard(session: import('../core/types').Session | null): Record<string, unknown> {
    if (!session) {
      return {
        config: { wide_screen_mode: true },
        header: { title: { tag: 'plain_text', content: 'ℹ️ 会话信息' }, template: 'blue' },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: '当前没有活跃会话' } }],
      };
    }
    return {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: 'ℹ️ 会话信息' }, template: 'blue' },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content:
              `**Session ID:** ${session.id}\n` +
              `**Agent:** ${session.agentType}\n` +
              `**消息数:** ${session.messages.length}\n` +
              `**状态:** ${session.state}\n` +
              `**创建时间:** ${session.createdAt.toLocaleString()}`,
          },
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '🔙 返回' },
              type: 'default',
              value: { action: 'back_to_menu' },
            },
          ],
        },
      ],
    };
  }

  // ========== Utilities ==========

  private findSidecarBinary(): string | null {
    const candidates = [
      path.join(process.cwd(), 'sidecars', 'feishu', 'feishu-sidecar'),
      path.join(process.cwd(), 'sidecars', 'feishu', 'feishu-sidecar-darwin-arm64'),
      path.join(__dirname, '..', '..', 'sidecars', 'feishu', 'feishu-sidecar'),
      path.join(os.homedir(), '.vibe-agent', 'sidecars', 'feishu-sidecar'),
    ];
    for (const c of candidates) {
      try {
        if (require('fs').existsSync(c)) {
          return c;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  isConnected(): boolean {
    return this.rpc?.isReady() ?? false;
  }
}
