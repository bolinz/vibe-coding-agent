import type { Router } from '../../core/router';
import type { Session, AgentType } from '../../core/types';

/**
 * Card builder for Feishu interactive cards.
 * Used by both SidecarFeishuChannel and any Feishu menu UI.
 */
export class FeishuCardBuilder {
  constructor(private router: Router) {}

  buildMenuCard(currentAgent: string, sessionId?: string): Record<string, unknown> {
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
              text: { tag: 'plain_text', content: '📋 切换会话' },
              type: 'default',
              value: { action: 'switch_session' },
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

  buildAgentSelectCard(): Record<string, unknown> {
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

  buildWelcomeCard(): Record<string, unknown> {
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

  buildSessionListCard(sessions: Array<{ id: string; agentType: string; messageCount: number }>, currentSessionId?: string): Record<string, unknown> {
    const actions = sessions.map((s) => ({
      tag: 'button',
      text: { tag: 'plain_text', content: `${s.id === currentSessionId ? '✅ ' : ''}${s.agentType} (${s.messageCount}条)` },
      type: s.id === currentSessionId ? 'primary' : 'default',
      value: { action: 'set_session', sessionId: s.id },
    }));

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '📋 切换会话' },
        template: 'blue',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: '选择一个会话：',
          },
        },
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

  buildInfoCard(session: Session | null): Record<string, unknown> {
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
}
