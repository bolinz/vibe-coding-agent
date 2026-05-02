import { h } from 'preact';

interface Props {
  connStatus: 'on' | 'ws' | 'off';
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function Header({ connStatus, sidebarCollapsed, onToggleSidebar }: Props) {
  const dotColor = connStatus === 'on' ? 'conn-on' : connStatus === 'ws' ? 'conn-ws' : 'conn-off';
  return (
    <header class="chat-header">
      <div class="chat-header-title">
        <button id="sidebarToggle" onClick={onToggleSidebar} style="background:transparent;border:none;color:#9999bb;font-size:1.1rem;padding:0.2rem 0.4rem;border-radius:6px;cursor:pointer;">
          {sidebarCollapsed ? '☰' : '✕'}
        </button>
        <span>🤖 AI Coding Agent</span>
        <span class={`conn-dot ${dotColor}`} title={connStatus === 'on' ? 'SSE 已连接' : connStatus === 'ws' ? 'WebSocket 已连接' : '未连接'}>●</span>
      </div>
      <nav class="chat-header-nav">
        <a href="/">💬</a>
        <a href="/config">⚙️</a>
      </nav>
    </header>
  );
}
