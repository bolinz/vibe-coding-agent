import type { AgentType } from '../../core/types';
import type { SessionManager } from '../../core/session';
import type { Router } from '../../core/router';

export type UserMenuState = 'idle' | 'menu' | 'select_agent';

interface UserState {
  state: UserMenuState;
  timer: ReturnType<typeof setTimeout> | null;
}

const MENU_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Manages Feishu menu state machine and command dispatch.
 * Extracted to avoid duplication between FeishuChannel and SidecarFeishuChannel.
 */
export class FeishuMenuStateManager {
  private userStates = new Map<string, UserState>();
  private processedActions = new Set<string>();
  private hasInteracted = new Set<string>();

  private sessionManager: SessionManager;
  private router: Router;
  private sendMessage: (userId: string, text: string) => Promise<void>;
  private sendMenu: (userId: string) => Promise<void>;
  private sendAgentSelectMenu: (userId: string) => Promise<void>;

  constructor(
    sessionManager: SessionManager,
    router: Router,
    sendMessage: (userId: string, text: string) => Promise<void>,
    sendMenu: (userId: string) => Promise<void>,
    sendAgentSelectMenu: (userId: string) => Promise<void>,
  ) {
    this.sessionManager = sessionManager;
    this.router = router;
    this.sendMessage = sendMessage;
    this.sendMenu = sendMenu;
    this.sendAgentSelectMenu = sendAgentSelectMenu;
  }

  // ===== State Management =====

  getUserState(userId: string): UserMenuState {
    return this.userStates.get(userId)?.state ?? 'idle';
  }

  setUserState(userId: string, state: UserMenuState): void {
    const existing = this.userStates.get(userId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }

    const timer = state === 'idle'
      ? null
      : setTimeout(() => {
          this.userStates.set(userId, { state: 'idle', timer: null });
        }, MENU_TIMEOUT_MS);

    this.userStates.set(userId, { state, timer });
  }

  // ===== Action Deduplication =====

  isDuplicateAction(token: string): boolean {
    return this.processedActions.has(token);
  }

  markAction(token: string, ttl = 3000): void {
    this.processedActions.add(token);
    setTimeout(() => this.processedActions.delete(token), ttl);
  }

  // ===== Interaction Tracking =====

  markInteracted(userId: string): void {
    this.hasInteracted.add(userId);
  }

  hasInteractedBefore(userId: string): boolean {
    return this.hasInteracted.has(userId);
  }

  // ===== Command Handling =====

  isMenuTrigger(text: string): boolean {
    const triggers = ['菜单', 'menu', 'help', '?', '？'];
    return triggers.includes(text.toLowerCase().trim());
  }

  async handleCommand(openId: string, text: string): Promise<boolean> {
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
        await this.sendMessage(openId, `✅ 已创建新会话\nAgent: ${newSession.agentType}`);
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
        await this.sendMessage(openId, '已取消');
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

    const agentName = agents[index].name;
    const session = await this.sessionManager.getByUserId(openId);

    if (session) {
      await this.sessionManager.switchAgent(session.id, agentName);
    } else {
      await this.sessionManager.create(openId, agentName, { workingDir: '/projects/sandbox' }, openId);
    }

    await this.sendMessage(openId, `✅ 已切换至 ${agentName} Agent`);
    this.setUserState(openId, 'idle');
    return true;
  }

  private async sendSessionInfo(openId: string): Promise<void> {
    const session = await this.sessionManager.getByUserId(openId);
    if (!session) {
      await this.sendMessage(openId, 'ℹ️ 当前没有活跃会话');
      return;
    }

    const infoText =
      'ℹ️ 当前会话信息\n\n' +
      `Session ID: ${session.id}\n` +
      `Agent: ${session.agentType}\n` +
      `消息数: ${session.messages.length}\n` +
      `状态: ${session.state}\n` +
      `创建时间: ${session.createdAt.toLocaleString()}`;

    await this.sendMessage(openId, infoText);
  }
}
