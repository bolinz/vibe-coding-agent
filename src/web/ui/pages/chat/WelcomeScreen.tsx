import { h } from 'preact';
import { MessageSquare, Keyboard, SendHorizonal, Plus } from 'lucide-preact';

interface Props {
  onCreateSession: () => Promise<void>;
}

export function WelcomeScreen({ onCreateSession }: Props) {
  return (
    <div class="welcome-screen">
      <div class="welcome-content">
        <div class="welcome-logo">
          <MessageSquare size={24} />
        </div>
        <h2 class="welcome-title">AI Coding Agent</h2>
        <p class="welcome-subtitle">多渠道 AI Agent 共享会话框架</p>

        <div class="welcome-shortcuts">
          <div class="shortcut-item">
            <span class="shortcut-key"><SendHorizonal size={14} /></span>
            <span class="shortcut-label">Enter 发送消息</span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-key"><Keyboard size={14} /></span>
            <span class="shortcut-label">双击目录编辑工作路径</span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-key"><Plus size={14} /></span>
            <span class="shortcut-label">新建会话</span>
          </div>
        </div>

        <button class="welcome-btn" onClick={onCreateSession}>
          <MessageSquare size={16} />
          开始新对话
        </button>
      </div>
    </div>
  );
}
