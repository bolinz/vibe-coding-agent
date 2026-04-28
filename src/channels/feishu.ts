import type { ChannelType, AgentType } from '../core/types';
import { BaseChannel } from './base';
import * as lark from '@larksuiteoapi/node-sdk';
import type { SessionManager } from '../core/session';

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

const MENU_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class FeishuChannel extends BaseChannel {
  readonly type: ChannelType = 'feishu';
  readonly name = 'Feishu Bot';

  private config: FeishuConfig;
  private client: lark.Client | null = null;
  private wsClient: lark.WSClient | null = null;
  private connected = false;
  private sessionManager: SessionManager;
  private userStates = new Map<string, UserState>();
  private hasInteracted = new Set<string>(); // Track first-time users
  private processedActions = new Set<string>(); // Deduplicate card actions by token

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
      console.log('[Feishu] App ID or Secret not configured, skipping connection');
      return;
    }

    const domain = this.config.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;
    const baseConfig = {
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain,
    };

    try {
      this.client = new lark.Client(baseConfig);

      const eventDispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data: Record<string, unknown>) => {
          await this.handleWSMessage(data);
        },
        'card.action.trigger': async (data: Record<string, unknown>) => {
          await this.handleCardAction(data);
        },
      });

      this.wsClient = new lark.WSClient({
        ...baseConfig,
        loggerLevel: lark.LoggerLevel.warn,
      });

      await this.wsClient.start({ eventDispatcher });
      this.connected = true;
      console.log('[Feishu] Bot connected via WebSocket');
    } catch (error) {
      this.connected = false;
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Feishu] Connection failed:', errMsg);
      // Don't throw — let the server start even if Feishu is not connected
    }
  }

  async disconnect(): Promise<void> {
    if (this.wsClient) {
      try {
        this.wsClient.close({ force: true });
      } catch {
        // ignore
      }
      this.wsClient = null;
    }
    this.client = null;
    this.connected = false;
    console.log('[Feishu] Disconnected');
  }

  async handleMessage(_event: unknown): Promise<void> {
    // HTTP webhook no longer used — all events come via WebSocket
    return Promise.resolve();
  }

  // ========== Menu State Management ==========

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

  // ========== Menu Responses ==========

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

  // ========== Command Handlers ==========

  private async handleCommand(openId: string, text: string): Promise<boolean> {
    const state = this.getUserState(openId);

    // Global menu trigger
    if (this.isMenuTrigger(text)) {
      await this.sendMenu(openId);
      return true;
    }

    // State-based command handling
    if (state === 'menu') {
      return await this.handleMenuCommand(openId, text);
    }

    if (state === 'select_agent') {
      return await this.handleAgentSelectCommand(openId, text);
    }

    return false; // Not a command — pass to agent
  }

  private async handleMenuCommand(openId: string, text: string): Promise<boolean> {
    switch (text.trim()) {
      case '1': {
        // New session — close existing first
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
        await this.send(openId, `✅ 已创建新会话\nSession ID: ${newSession.id}\nAgent: ${newSession.agentType}`);
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
        // Invalid input — fall through to agent instead of showing error
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
      // Invalid input — fall through to agent
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

  // ========== Message Handler ==========

  private async handleWSMessage(data: Record<string, unknown>): Promise<void> {
    try {
      // SDK passes event data directly (not wrapped in data.event)
      const message = data.message as Record<string, unknown> | undefined;
      const sender = data.sender as Record<string, unknown> | undefined;
      const senderId = sender?.sender_id as Record<string, unknown> | undefined;
      const openId = senderId?.open_id as string | undefined;
      const contentStr = message?.content as string | undefined;

      if (!openId || !contentStr) {
        console.warn('[Feishu] Missing open_id or content, data keys:', Object.keys(data));
        return;
      }

      let text = '';
      try {
        const parsed = JSON.parse(contentStr);
        text = (parsed.text ?? parsed.content ?? '').trim();
      } catch {
        text = contentStr.trim();
      }

      if (!text) {
        console.warn('[Feishu] Empty message text');
        return;
      }

      console.log(`[Feishu] Received from ${openId}: ${text.substring(0, 100)}`);

      // Mark as interacted on any message
      this.hasInteracted.add(openId);

      // Check if it's a command/menu interaction
      const handled = await this.handleCommand(openId, text);
      if (handled) return;

      // Route to agent
      const unifiedMessage = this.createUnifiedMessage(
        openId,
        openId,
        text,
        openId
      );

      await this.router.route(unifiedMessage);
    } catch (error) {
      console.error('[Feishu] Error handling WS message:', error);
    }
  }

  // ========== Card Methods ==========

  private async sendCard(openId: string, card: Record<string, unknown>): Promise<boolean> {
    if (!this.client) {
      console.error('[Feishu] Client not initialized');
      return false;
    }

    try {
      await this.client.im.message.create({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: openId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });
      return true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn('[Feishu] Card send failed, will fallback to text:', errMsg);
      return false;
    }
  }

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

  private async handleCardAction(data: Record<string, unknown>): Promise<void> {
    try {
      const dataAny = data as any;
      const openId = (dataAny.open_id as string) || (dataAny.operator?.open_id as string);
      const actionValue = dataAny.action?.value as Record<string, unknown> | undefined;

      if (!openId || !actionValue) {
        console.warn('[Feishu] Card action missing open_id or value');
        return;
      }

      // Deduplicate: use token from event or hash of action+user
      const actionToken = (data.token as string) || `${openId}_${JSON.stringify(actionValue)}`;
      if (this.processedActions.has(actionToken)) {
        console.log(`[Feishu] Duplicate card action ignored: ${actionToken}`);
        return;
      }
      this.processedActions.add(actionToken);
      // Clean up old tokens after 10s to prevent memory leak
      setTimeout(() => this.processedActions.delete(actionToken), 10000);

      // Mark as interacted
      this.hasInteracted.add(openId);

      const action = actionValue.action as string;
      console.log(`[Feishu] Card action from ${openId}: ${action}`);

      switch (action) {
        case 'new_session': {
          // Close existing session properly
          const existingSession = await this.sessionManager.getByUserId(openId);
          if (existingSession) {
            await this.sessionManager.close(existingSession.id).catch(() => {});
          }
          const newSession = await this.sessionManager.create(
            openId,
            this.router.getDefaultAgent(),
            { workingDir: '/projects/sandbox' },
            openId
          );
          await this.send(openId, `✅ 已创建新会话\nAgent: ${newSession.agentType}`);
          this.setUserState(openId, 'idle');
          break;
        }

        case 'switch_agent': {
          const card = this.buildAgentSelectCard();
          const sent = await this.sendCard(openId, card);
          if (!sent) await this.sendAgentSelectMenu(openId);
          else this.setUserState(openId, 'select_agent');
          break;
        }

        case 'set_agent': {
          const agentName = actionValue.agent as AgentType;
          const session = await this.sessionManager.getByUserId(openId);
          if (session) {
            await this.sessionManager.switchAgent(session.id, agentName);
          } else {
            await this.sessionManager.create(openId, agentName, { workingDir: '/projects/sandbox' }, openId);
          }
          await this.send(openId, `✅ 已切换至 ${agentName} Agent`);
          this.setUserState(openId, 'idle');
          break;
        }

        case 'info':
          await this.sendSessionInfo(openId);
          break;

        case 'back_to_menu': {
          // Return to idle so user can chat directly
          this.setUserState(openId, 'idle');
          await this.send(openId, '已返回，可直接发送消息开始对话');
          break;
        }

        case 'open_menu': {
          const currentSession = await this.sessionManager.getByUserId(openId);
          const currentAgent = currentSession?.agentType ?? this.router.getDefaultAgent();
          const card = this.buildMenuCard(currentAgent, currentSession?.id);
          const sent = await this.sendCard(openId, card);
          if (!sent) await this.sendMenu(openId);
          else this.setUserState(openId, 'menu');
          break;
        }

        default:
          console.warn('[Feishu] Unknown card action:', action);
      }
    } catch (error) {
      console.error('[Feishu] Error handling card action:', error);
    }
  }

  // ========== Updated Menu Methods with Card Fallback ==========

  private async sendMenu(openId: string): Promise<void> {
    const session = await this.sessionManager.getByUserId(openId);
    const currentAgent = session?.agentType ?? this.router.getDefaultAgent();

    const card = this.buildMenuCard(currentAgent, session?.id);
    const sent = await this.sendCard(openId, card);
    if (!sent) {
      const menuText =
        '🤖 AI Agent 控制台\n\n' +
        '1. 🆕 新建会话\n' +
        `2. 🤖 切换 Agent (当前: ${currentAgent})\n` +
        '3. ℹ️ 查看当前会话\n' +
        '0. ❌ 取消\n\n' +
        '请回复数字选择操作';
      await this.send(openId, menuText);
    }
    this.setUserState(openId, 'menu');
  }

  private async sendAgentSelectMenu(openId: string): Promise<void> {
    const card = this.buildAgentSelectCard();
    const sent = await this.sendCard(openId, card);
    if (!sent) {
      const agents = this.router.getAvailableAgents();
      let text = '🤖 切换 Agent\n\n';
      agents.forEach((agent, index) => {
        text += `${index + 1}. ${agent.name} — ${agent.description}\n`;
      });
      text += '0. 🔙 返回上级\n\n请回复数字选择';
      await this.send(openId, text);
    }
    this.setUserState(openId, 'select_agent');
  }

  private async sendWelcome(openId: string): Promise<void> {
    const card = this.buildWelcomeCard();
    const sent = await this.sendCard(openId, card);
    if (!sent) {
      const welcomeText =
        '👋 欢迎使用 AI Coding Agent！\n\n' +
        '我可以帮你：\n' +
        '• 💬 聊天对话\n' +
        '• 🛠️ 执行 Shell / Git / File 工具\n' +
        '• 🤖 切换不同 AI Agent\n\n' +
        '发送「菜单」随时呼出控制台';
      await this.send(openId, welcomeText);
    }
    // After welcome, also send menu
    await this.sendMenu(openId);
  }

  // ========== Text Send ==========

  async send(sessionId: string, message: string): Promise<void> {
    if (!this.client) {
      console.error('[Feishu] Client not initialized');
      return;
    }

    try {
      await this.client.im.message.create({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: sessionId,
          msg_type: 'text',
          content: JSON.stringify({ text: message }),
        },
      });
      console.log(`[Feishu] Sent message to ${sessionId}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Feishu] Failed to send message:', errMsg);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
