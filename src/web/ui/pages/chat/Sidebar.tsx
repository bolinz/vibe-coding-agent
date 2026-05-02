import { h } from 'preact';
import { useState } from 'preact/hooks';
import type { SessionData } from '../../shared/types';
import { formatTime } from '../../shared/utils';
import { api } from '../../shared/api';

interface Props {
  collapsed: boolean;
  sessions: SessionData[];
  currentSessionId: string | null;
  onSwitch: (id: string) => Promise<void>;
  onCreate: () => Promise<void>;
  onSessionsChange: () => Promise<void>;
}

function SessionItem({ session, isActive, onSwitch, onSessionsChange }: {
  session: SessionData;
  isActive: boolean;
  onSwitch: (id: string) => Promise<void>;
  onSessionsChange: () => Promise<void>;
}) {
  const [editingWD, setEditingWD] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const channels = (session.participants || []).map(p => {
    if (p.channel === 'feishu') return '📱';
    if (p.channel === 'websocket') return '🌐';
    if (p.channel === 'ssh') return '💻';
    return '';
  }).join(' ');

  const cls = [
    'session-item',
    isActive ? 'active' : '',
    session.pinned ? 'pinned' : '',
    deleting ? 'deleting' : '',
  ].filter(Boolean).join(' ');

  const handleDelete = async (e: MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    try {
      await api.sessions.close(session.id);
    } catch {}
    onSessionsChange();
  };

  const handlePin = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      if (session.pinned) await api.sessions.unpin(session.id);
      else await api.sessions.pin(session.id);
    } catch {}
    onSessionsChange();
  };

  const handleAgentChange = async (e: Event) => {
    e.stopPropagation();
    const agent = (e.target as HTMLSelectElement).value;
    try {
      await api.sessions.switchAgent(session.id, agent);
    } catch {}
    onSessionsChange();
  };

  const handleWDBlur = async (e: FocusEvent) => {
    const val = (e.target as HTMLInputElement).value.trim() || '/projects/sandbox';
    try {
      await api.sessions.setWorkingDir(session.id, val);
    } catch {}
    setEditingWD(false);
    onSessionsChange();
  };

  const handleWDKey = async (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleWDBlur(e as unknown as FocusEvent);
    if (e.key === 'Escape') setEditingWD(false);
  };

  const AGENTS = ['echo', 'opencode', 'hermes', 'claude', 'codex', 'cline', 'aider'];

  return (
    <div class={cls} onClick={() => onSwitch(session.id)}>
      <button class="session-del" onClick={handleDelete} title="关闭会话">×</button>
      <div class="session-name">
        {session.pinned ? '📌 ' : ''}{session.agentType} {session.id.slice(0, 8)}
        <span class="session-channels">{channels}</span>
      </div>
      <div class="session-meta">{session.messageCount} 条 · {formatTime(session.createdAt)}</div>
      {editingWD ? (
        <input
          class="session-wd-input"
          type="text"
          defaultValue={session.workingDir || '/projects/sandbox'}
          onBlur={handleWDBlur}
          onKeyDown={handleWDKey}
          autoFocus
        />
      ) : (
        <div class="session-wd" onDblClick={(e) => { e.stopPropagation(); setEditingWD(true); }}>
          {session.workingDir || '/projects/sandbox'}
        </div>
      )}
      <select class="session-agent" value={session.agentType} onChange={handleAgentChange} onClick={(e) => e.stopPropagation()}>
        {AGENTS.map(a => <option value={a}>{a}</option>)}
      </select>
      <button class="session-pin" onClick={handlePin} title={session.pinned ? '取消保存' : '永久保存'}>
        {session.pinned ? '📌' : '📍'}
      </button>
    </div>
  );
}

export function Sidebar({ collapsed, sessions, currentSessionId, onSwitch, onCreate, onSessionsChange }: Props) {
  const sorted = [...sessions].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  return (
    <aside class={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div class="sidebar-header">
        <h3>📋 会话</h3>
        <button onClick={onCreate} title="新建会话">+</button>
      </div>
      <div class="session-list">
        {sorted.map(s => (
          <SessionItem
            key={s.id}
            session={s}
            isActive={s.id === currentSessionId}
            onSwitch={onSwitch}
            onSessionsChange={onSessionsChange}
          />
        ))}
      </div>
    </aside>
  );
}
