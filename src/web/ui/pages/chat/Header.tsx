import { h } from 'preact';
import { Menu, X, MessageCircle, Settings } from 'lucide-preact';

interface Props {
  connStatus: 'on' | 'ws' | 'off';
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function Header({ connStatus, sidebarCollapsed, onToggleSidebar }: Props) {
  const dotClass = connStatus === 'on' ? 'conn-on' : connStatus === 'ws' ? 'conn-ws' : 'conn-off';
  const title = connStatus === 'on' ? 'SSE 已连接' : connStatus === 'ws' ? 'WebSocket 已连接' : '未连接';

  return (
    <header class="chat-header">
      <div class="chat-header-title">
        <button class="sidebar-toggle" onClick={onToggleSidebar}>
          {sidebarCollapsed ? <Menu size={18} /> : <X size={18} />}
        </button>
        <span>AI Coding Agent</span>
        <span class={`conn-dot ${dotClass}`} title={title} />
      </div>
      <nav class="chat-header-nav">
        <a href="/" title="Chat"><MessageCircle size={16} /></a>
        <a href="/config" title="配置"><Settings size={16} /></a>
      </nav>
    </header>
  );
}
