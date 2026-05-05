import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Plus, X, Pin, PinOff, Folder, Smartphone, Globe, Terminal } from 'lucide-preact';
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
  agentNames: string[];
}

const CHANNEL_ICONS: Record<string, any> = {
  feishu: Smartphone,
  websocket: Globe,
  ssh: Terminal,
};

function SessionItem({ session, isActive, onSwitch, onSessionsChange, agentNames }: {
  session: SessionData;
  isActive: boolean;
  onSwitch: (id: string) => Promise<void>;
  onSessionsChange: () => Promise<void>;
  agentNames: string[];
}) {
  const [editingWD, setEditingWD] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const channels = (session.participants || []).map(p => CHANNEL_ICONS[p.channel]).filter(Boolean);

  const cls = [
    'session-item',
    isActive ? 'active' : '',
    session.pinned ? 'pinned' : '',
    deleting ? 'deleting' : '',
  ].filter(Boolean).join(' ');

  const handleDelete = async (e: MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    try { await api.sessions.close(session.id); } catch {}
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
    try { await api.sessions.switchAgent(session.id, agent); } catch {}
    onSessionsChange();
  };

  const handleWDBlur = async (e: FocusEvent) => {
    const val = (e.target as HTMLInputElement).value.trim() || '/projects/sandbox';
    try { await api.sessions.setWorkingDir(session.id, val); } catch {}
    setEditingWD(false);
    onSessionsChange();
  };

  const handleWDKey = async (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleWDBlur(e as unknown as FocusEvent);
    if (e.key === 'Escape') setEditingWD(false);
  };


  return (
    <div class={cls} onClick={() => onSwitch(session.id)}>
      <button class="session-del" onClick={handleDelete} title="关闭会话">
        <X size={13} />
      </button>
      <div class="session-name">
        <span>{session.agentType} {session.id.slice(0, 8)}</span>
        <span class="session-channels">
          {channels.map((Icon, i) => <Icon key={i} size={12} />)}
        </span>
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
          <Folder size={11} />
          {session.workingDir || '/projects/sandbox'}
        </div>
      )}
      <select class="session-agent" value={session.agentType} onChange={handleAgentChange} onClick={(e) => e.stopPropagation()}>
        {agentNames.map(a => <option value={a}>{a}</option>)}
      </select>
      <button class="session-pin" onClick={handlePin} title={session.pinned ? '取消置顶' : '置顶'}>
        {session.pinned ? <Pin size={13} /> : <PinOff size={13} />}
      </button>
    </div>
  );
}

export function Sidebar({ collapsed, sessions, currentSessionId, onSwitch, onCreate, onSessionsChange, agentNames }: Props) {
  const sorted = [...sessions].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  return (
    <aside class={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div class="sidebar-header">
        <h3>Sessions</h3>
        <button onClick={onCreate} title="新建会话"><Plus size={16} /></button>
      </div>
      <div class="session-list">
        {sorted.map(s => (
          <SessionItem
            key={s.id}
            session={s}
            isActive={s.id === currentSessionId}
            onSwitch={onSwitch}
            onSessionsChange={onSessionsChange}
            agentNames={agentNames}
          />
        ))}
      </div>
    </aside>
  );
}
