import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Plus, Trash2, Box, Cpu } from 'lucide-preact';
import { api } from '../../shared/api';

interface AgentInfo {
  name: string;
  description: string;
  runtimeType: string;
  hasContainer: boolean;
  streaming: boolean;
  multiTurn: boolean;
}

interface Props {
  agents: AgentInfo[];
  onAgentsChange: () => void;
}

export function AgentManager({ agents, onAgentsChange }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    runtimeType: 'cli',
    command: '',
    args: '',
    image: '',
    containerCmd: '',
    streaming: false,
    multiTurn: false,
  });

  const handleRegister = async (e: Event) => {
    e.preventDefault();
    try {
      await api.agents.register({
        ...form,
        args: form.args.split(' ').filter(Boolean),
        image: form.image || undefined,
        containerCmd: form.containerCmd || undefined,
      });
      setShowForm(false);
      setForm({ name: '', description: '', runtimeType: 'cli', command: '', args: '', image: '', containerCmd: '', streaming: false, multiTurn: false });
      onAgentsChange();
    } catch {}
  };

  const handleUnregister = async (name: string) => {
    if (!confirm(`确定删除 agent "${name}"？`)) return;
    try {
      await api.agents.unregister(name);
      onAgentsChange();
    } catch {}
  };

  return (
    <div class="config-section">
      <div class="config-section-header" style="display:flex;align-items:center;justify-content:space-between;">
        <span>已注册 Agent</span>
        <button class="btn-add-agent" onClick={() => setShowForm(v => !v)}>
          <Plus size={14} />
          {showForm ? '取消' : '新增 Agent'}
        </button>
      </div>

      {showForm && (
        <form class="agent-form" onSubmit={handleRegister}>
          <div class="agent-form-row">
            <div class="agent-form-field">
              <label>名称 *</label>
              <input type="text" value={form.name} onInput={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} required placeholder="my-agent" />
            </div>
            <div class="agent-form-field">
              <label>描述</label>
              <input type="text" value={form.description} onInput={(e) => setForm({ ...form, description: (e.target as HTMLInputElement).value })} placeholder="My custom agent" />
            </div>
          </div>
          <div class="agent-form-row">
            <div class="agent-form-field">
              <label>运行时</label>
              <select value={form.runtimeType} onChange={(e) => setForm({ ...form, runtimeType: (e.target as HTMLSelectElement).value })}>
                <option value="cli">CLI</option>
                <option value="container">容器</option>
                <option value="session">会话</option>
              </select>
            </div>
            <div class="agent-form-field">
              <label>命令 *</label>
              <input type="text" value={form.command} onInput={(e) => setForm({ ...form, command: (e.target as HTMLInputElement).value })} required placeholder="echo" />
            </div>
          </div>
          <div class="agent-form-row">
            <div class="agent-form-field" style="flex:2">
              <label>参数（空格分隔，{'{message}'} 为消息占位符）</label>
              <input type="text" value={form.args} onInput={(e) => setForm({ ...form, args: (e.target as HTMLInputElement).value })} placeholder="Echo: {message}" />
            </div>
          </div>
          {form.runtimeType === 'container' && (
            <div class="agent-form-row">
              <div class="agent-form-field">
                <label>容器镜像</label>
                <input type="text" value={form.image} onInput={(e) => setForm({ ...form, image: (e.target as HTMLInputElement).value })} placeholder="alpine:latest" />
              </div>
              <div class="agent-form-field">
                <label>容器命令</label>
                <input type="text" value={form.containerCmd} onInput={(e) => setForm({ ...form, containerCmd: (e.target as HTMLInputElement).value })} placeholder="podman（留空使用默认）" />
              </div>
            </div>
          )}
          <div class="agent-form-row" style="gap:1rem;">
            <label style="display:flex;align-items:center;gap:0.375rem;font-size:0.8125rem;">
              <input type="checkbox" checked={form.streaming} onChange={(e) => setForm({ ...form, streaming: (e.target as HTMLInputElement).checked })} />
              支持流式输出
            </label>
            <label style="display:flex;align-items:center;gap:0.375rem;font-size:0.8125rem;">
              <input type="checkbox" checked={form.multiTurn} onChange={(e) => setForm({ ...form, multiTurn: (e.target as HTMLInputElement).checked })} />
              支持多轮对话
            </label>
          </div>
          <div class="agent-form-actions">
            <button type="submit" class="btn-config-save">注册 Agent</button>
          </div>
        </form>
      )}

      <div class="agent-table">
        <div class="agent-table-header">
          <span>名称</span>
          <span>描述</span>
          <span>运行时</span>
          <span>容器</span>
          <span>流式</span>
          <span>操作</span>
        </div>
        {agents.map(a => (
          <div class="agent-table-row">
            <span class="agent-name">{a.name}</span>
            <span class="agent-desc">{a.description}</span>
            <span><span class={`agent-badge runtime-${a.runtimeType}`}>{a.runtimeType}</span></span>
            <span>{a.hasContainer ? <Box size={14} /> : '-'}</span>
            <span>{a.streaming ? '✓' : '-'}</span>
            <span>
              <button class="btn-agent-del" onClick={() => handleUnregister(a.name)} title="删除">
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
