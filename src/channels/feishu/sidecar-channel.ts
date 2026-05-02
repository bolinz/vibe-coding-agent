import type { Channel, ChannelCapabilities, OutgoingMessage } from '../types';
import type { Router } from '../../core/router';
import type { SessionManager } from '../../core/session';
import type { EventBus } from '../../core/event';
import type { SessionBindingStore } from '../../core/session-binding';
import { SidecarRPC } from '../../core/sidecar-rpc';
import { FeishuCardBuilder } from './card-builder';
import { FeishuMenuStateManager } from './menu-state';
import { findSidecarBinary } from '../../plugins/sidecar-loader';

interface FeishuConfig {
  appId: string;
  appSecret: string;
  domain?: 'feishu' | 'lark';
}

export class SidecarFeishuChannel implements Channel {
  readonly type = 'feishu';
  readonly name = 'Feishu Bot (Sidecar)';
  readonly capabilities: ChannelCapabilities = {
    text: true,
    cards: true,
    images: false,
    files: false,
    richText: true,
    cardActions: true,
  };

  private config: FeishuConfig;
  private rpc: SidecarRPC | null = null;
  private cardBuilder: FeishuCardBuilder;
  private menuState: FeishuMenuStateManager;
  private router: Router;
  private eventBus: EventBus;
  private sessionBinding: SessionBindingStore;
  private loadingMessageIds = new Map<string, string>();
  private unsubscribeEvent: (() => void) | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private shouldReconnect = false;

  constructor(
    router: Router,
    private sessionManager: SessionManager,
    eventBus: EventBus,
    sessionBinding: SessionBindingStore,
    config: FeishuConfig,
  ) {
    this.router = router;
    this.config = config;
    this.eventBus = eventBus;
    this.sessionBinding = sessionBinding;
    this.cardBuilder = new FeishuCardBuilder(router);
    this.menuState = new FeishuMenuStateManager(
      sessionManager,
      router,
      (userId, text) => this.sendText(userId, text),
      (userId) => this.sendCard(userId, this.cardBuilder.buildMenuCard(
        router.getDefaultAgent(),
      )),
      (userId) => this.sendCard(userId, this.cardBuilder.buildAgentSelectCard()),
    );
  }

  async connect(): Promise<void> {
    if (!this.config.appId || !this.config.appSecret) {
      console.log('[FeishuSidecar] App ID or Secret not configured, skipping');
      return;
    }

    await this.startSidecar();
    this.subscribeEvents();
  }

  private async startSidecar(): Promise<void> {
    const sidecarPath = findSidecarBinary('feishu');
    if (!sidecarPath) {
      console.error('[FeishuSidecar] feishu-sidecar binary not found');
      return;
    }

    const domain = this.config.domain === 'lark' ? 'https://open.larksuite.com' : '';

    this.rpc = new SidecarRPC(sidecarPath, [], {
      FEISHU_APP_ID: this.config.appId,
      FEISHU_APP_SECRET: this.config.appSecret,
      FEISHU_DOMAIN: domain,
    });

    this.rpc.registerMethod('cardAction', (params: any) => this.handleCardAction(params));
    this.rpc.on('message', (params: any) => this.handleSidecarMessage(params));

    this.rpc.on('exit', (code: number | null) => {
      console.log(`[FeishuSidecar] Sidecar exited with code ${code}`);
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });

    await this.rpc.start();
    this.reconnectAttempts = 0;
    console.log('[FeishuSidecar] Connected via Go sidecar');
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.error('[FeishuSidecar] Max reconnect attempts reached');
      return;
    }
    console.log(`[FeishuSidecar] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    setTimeout(() => this.startSidecar(), delay);
  }

  private subscribeEvents(): void {
    const unsub1 = this.eventBus.subscribe('agent.thinking', (event) => {
      this.resolveFeishuUserId(event.sessionId).then((uid) => {
        if (uid) this.handleThinking(uid, (event.data as any)?.content);
      });
    });
    const unsub2 = this.eventBus.subscribe('agent.tool_executing', (event) => {
      this.resolveFeishuUserId(event.sessionId).then((uid) => {
        if (uid) this.handleToolExecuting(uid, (event.data as any)?.toolName);
      });
    });
    const unsub3 = this.eventBus.subscribe('agent.error', (event) => {
      this.resolveFeishuUserId(event.sessionId).then((uid) => {
        if (uid) this.handleError(uid, (event.data as any)?.error);
      });
    });
    this.unsubscribeEvent = () => { unsub1(); unsub2(); unsub3(); };
  }

  private async handleThinking(userId: string, _userMessage: string): Promise<void> {
    const loadingCard = this.cardBuilder.buildLoadingCard();
    try {
      const result = await this.rpc?.call('sendCardSync', {
        receiveId: userId,
        card: loadingCard,
      }) as any;
      if (result?.messageId) {
        this.loadingMessageIds.set(userId, result.messageId);
      }
    } catch (error) {
      console.error('[FeishuSidecar] Failed to send loading card:', error);
    }
  }

  private async handleToolExecuting(userId: string, toolName: string): Promise<void> {
    const card = this.cardBuilder.buildToolExecutingCard(toolName);
    try {
      await this.rpc?.call('sendCardSync', { receiveId: userId, card });
    } catch (error) {
      console.error('[FeishuSidecar] Failed to send tool executing card:', error);
    }
  }

  private async handleResponse(userId: string, content: string): Promise<void> {
    this.loadingMessageIds.delete(userId);
    if (!content) return;
    await this.sendText(userId, content);
  }

  private async handleError(userId: string, errorMsg: string): Promise<void> {
    this.loadingMessageIds.delete(userId);
    if (!errorMsg) return;
    await this.sendText(userId, `❌ 发生错误：${errorMsg}`);
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    if (this.unsubscribeEvent) {
      this.unsubscribeEvent();
      this.unsubscribeEvent = null;
    }
    if (this.rpc) {
      try { await this.rpc.call('disconnect'); } catch {}
      this.rpc.stop();
      this.rpc = null;
    }
    console.log('[FeishuSidecar] Disconnected');
  }

  isConnected(): boolean {
    return this.rpc?.isReady() ?? false;
  }

  handleEvent(_event: unknown): Promise<void> {
    return Promise.resolve();
  }

  async send(sessionId: string, message: OutgoingMessage): Promise<void> {
    const feishuUserId = await this.resolveFeishuUserId(sessionId);
    if (!feishuUserId) return;
    if (message.card && this.capabilities.cards) {
      await this.sendCard(feishuUserId, message.card);
    } else {
      await this.sendText(feishuUserId, message.text);
    }
  }

  private async resolveFeishuUserId(sessionId: string): Promise<string | null> {
    const session = await this.sessionManager.get(sessionId);
    if (!session?.participants) return null;
    const feishu = session.participants.find((p) => p.channel === 'feishu');
    return feishu?.userId ?? null;
  }

  // ===== Internal Send =====

  private async sendText(userId: string, text: string): Promise<void> {
    if (!this.rpc) return;
    try {
      await this.rpc.call('sendMessage', {
        receiveId: userId,
        content: text,
        msgType: 'text',
      });
    } catch (error) {
      console.error('[FeishuSidecar] Failed to send message:', error);
    }
  }

  private async sendCard(userId: string, card: Record<string, unknown>): Promise<void> {
    if (!this.rpc) return;
    try {
      await this.rpc.call('sendCardSync', { receiveId: userId, card });
    } catch (error) {
      console.error('[FeishuSidecar] Failed to send card:', error);
    }
  }

  // ===== Sidecar Event Handlers =====

  private async handleSidecarMessage(params: any): Promise<void> {
    const { userId, content } = params;
    if (!userId || !content) return;

    console.log(`[FeishuSidecar] Message from ${userId}: ${content.substring(0, 100)}`);
    this.menuState.markInteracted(userId);

    const handled = await this.menuState.handleCommand(userId, content);
    if (handled) return;

    // Get or create session via binding
    const sessionId = await this.sessionBinding.getOrCreate('feishu', userId, async () => {
      const session = await this.sessionManager.create(
        userId,
        this.router.getDefaultAgent(),
        { workingDir: '/projects/sandbox' },
        undefined,
        'feishu'
      );
      return session.id;
    });

    await this.router.route({
      channel: this.type,
      channelId: userId,
      sessionId,
      userId,
      role: 'user',
      content,
      timestamp: new Date(),
    });
  }

  async handleCardAction(params: any): Promise<{ card?: Record<string, unknown>; toast?: { type: string; content: string } }> {
    const { userId, action, value } = params;
    if (!userId || !action) {
      return {
        card: this.cardBuilder.buildMenuCard(this.router.getDefaultAgent()),
        toast: { type: 'error', content: 'Invalid action' },
      };
    }

    const actionToken = `${userId}_${action}_${JSON.stringify(value)}`;
    if (this.menuState.isDuplicateAction(actionToken)) {
      const session = await this.sessionManager.getByUserId(userId);
      const currentAgent = session?.agentType ?? this.router.getDefaultAgent();
      return {
        card: this.cardBuilder.buildMenuCard(currentAgent, session?.id),
        toast: { type: 'info', content: '正在处理...' },
      };
    }
    this.menuState.markAction(actionToken);
    this.menuState.markInteracted(userId);

    console.log(`[FeishuSidecar] Card action from ${userId}: ${action}`);

    switch (action) {
      case 'new_session':
        try {
          const newSession = await this.sessionManager.create(
            userId,
            this.router.getDefaultAgent(),
            { workingDir: '/projects/sandbox' },
            undefined,
            'feishu'
          );
          await this.sessionBinding.set('feishu', userId, newSession.id);
          return {
            card: this.cardBuilder.buildMenuCard(this.router.getDefaultAgent()),
            toast: { type: 'success', content: '已创建新会话' },
          };
        } catch (error) {
          return {
            card: this.cardBuilder.buildMenuCard(this.router.getDefaultAgent()),
            toast: { type: 'error', content: '创建会话失败' },
          };
        }

      case 'switch_agent':
        return {
          card: this.cardBuilder.buildAgentSelectCard(),
          toast: { type: 'info', content: '请选择 Agent' },
        };

      case 'set_agent': {
        const agentName = value?.agent as string;
        const session = await this.sessionManager.getByUserId(userId);
        const currentAgent = session?.agentType ?? this.router.getDefaultAgent();
        if (!agentName) {
          return {
            card: this.cardBuilder.buildMenuCard(currentAgent, session?.id),
            toast: { type: 'error', content: '未知 Agent' },
          };
        }
        try {
          await this.doSetAgent(userId, agentName);
          return {
            card: this.cardBuilder.buildMenuCard(agentName, session?.id),
            toast: { type: 'success', content: `已切换至 ${agentName}` },
          };
        } catch (error) {
          return {
            card: this.cardBuilder.buildMenuCard(currentAgent, session?.id),
            toast: { type: 'error', content: '切换 Agent 失败' },
          };
        }
      }

      case 'switch_session': {
        const sessions = await this.sessionManager.listAll();
        const bindingId = await this.sessionBinding.get('feishu', userId);
        return {
          card: this.cardBuilder.buildSessionListCard(
            sessions.map((s) => ({ id: s.id, agentType: s.agentType, messageCount: s.messages.length, pinned: s.pinned })),
            bindingId ?? undefined,
          ),
          toast: { type: 'info', content: '请选择会话' },
        };
      }

      case 'set_session': {
        const sessionId = value?.sessionId as string;
        if (!sessionId) {
          return {
            card: this.cardBuilder.buildMenuCard(this.router.getDefaultAgent()),
            toast: { type: 'error', content: '无效会话' },
          };
        }
        try {
          await this.sessionBinding.set('feishu', userId, sessionId);
          const targetSession = await this.sessionManager.get(sessionId);
          return {
            card: this.cardBuilder.buildMenuCard(targetSession?.agentType ?? this.router.getDefaultAgent(), sessionId),
            toast: { type: 'success', content: `已切换至 ${sessionId.slice(0, 8)}...` },
          };
        } catch (error) {
          return {
            card: this.cardBuilder.buildMenuCard(this.router.getDefaultAgent()),
            toast: { type: 'error', content: '切换会话失败' },
          };
        }
      }

      case 'info': {
        const bindingInfoSessionId = await this.sessionBinding.get('feishu', userId);
        const infoSession = bindingInfoSessionId ? await this.sessionManager.get(bindingInfoSessionId) : null;
        return {
          card: this.cardBuilder.buildInfoCard(infoSession),
          toast: { type: 'info', content: '会话信息' },
        };
      }

      case 'pin_session': {
        const pinSessionId = await this.sessionBinding.get('feishu', userId);
        const pinSession = pinSessionId ? await this.sessionManager.get(pinSessionId) : null;
        if (pinSession) {
          await this.sessionManager.pin(pinSession.id);
        }
        return {
          card: this.cardBuilder.buildInfoCard(pinSession),
          toast: { type: 'success', content: '已永久保存' },
        };
      }

      case 'unpin_session': {
        const unpinSessionId = await this.sessionBinding.get('feishu', userId);
        const unpinSession = unpinSessionId ? await this.sessionManager.get(unpinSessionId) : null;
        if (unpinSession) {
          await this.sessionManager.unpin(unpinSession.id);
        }
        return {
          card: this.cardBuilder.buildInfoCard(unpinSession),
          toast: { type: 'info', content: '已取消保存' },
        };
      }

      case 'back_to_menu':
      case 'open_menu': {
        this.menuState.setUserState(userId, 'menu');
        const menuBindingId = await this.sessionBinding.get('feishu', userId);
        const menuSession = menuBindingId ? await this.sessionManager.get(menuBindingId) : null;
        return {
          card: this.cardBuilder.buildMenuCard(menuSession?.agentType ?? this.router.getDefaultAgent(), menuBindingId ?? undefined),
          toast: { type: 'info', content: '控制台' },
        };
      }

      default: {
        const session = await this.sessionManager.getByUserId(userId);
        const currentAgent = session?.agentType ?? this.router.getDefaultAgent();
        return {
          card: this.cardBuilder.buildMenuCard(currentAgent, session?.id),
          toast: { type: 'warning', content: '未知操作' },
        };
      }
    }
  }

  // ===== Async Side Effects =====

  private async doSetAgent(userId: string, agentName: string): Promise<void> {
    const bindingId = await this.sessionBinding.get('feishu', userId);
    if (bindingId) {
      await this.sessionManager.switchAgent(bindingId, agentName);
    } else {
      const session = await this.sessionManager.create(userId, agentName, { workingDir: '/projects/sandbox' }, undefined, 'feishu');
      await this.sessionBinding.set('feishu', userId, session.id);
    }
  }
}
