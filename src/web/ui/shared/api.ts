import type { SessionData, MessageData, AgentInfo } from './types';

const BASE = '/api';

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  return res.json();
}

export const api = {
  sessions: {
    list: (userId?: string) =>
      apiGet<{ sessions: SessionData[] }>('/sessions' + (userId ? `?userId=${userId}` : '')),
    get: (id: string) => apiGet<SessionData & { messages: MessageData[] }>(`/sessions/${id}`),
    create: (userId: string, agentType?: string, workingDir?: string) =>
      apiPost<{ id: string; agentType: string; workingDir?: string }>('/sessions', { userId, agentType, workingDir }),
    close: (id: string) => apiDelete<{ success: boolean }>(`/sessions/${id}`),
    pin: (id: string) => apiPost<{ id: string; pinned: boolean }>(`/sessions/${id}/pin`),
    unpin: (id: string) => apiPost<{ id: string; pinned: boolean }>(`/sessions/${id}/unpin`),
    switchAgent: (id: string, agentType: string) =>
      apiPost<{ id: string; agentType: string }>(`/sessions/${id}/switch-agent`, { agentType }),
    getWorkingDir: (id: string) =>
      apiGet<{ workingDir: string }>(`/sessions/${id}/working-dir`),
    setWorkingDir: (id: string, workingDir: string) =>
      apiPost<{ success: boolean; workingDir: string }>(`/sessions/${id}/working-dir`, { workingDir }),
  },

  chat: {
    send: (sessionId: string, message: string, userId: string) =>
      apiPost<{ success: boolean }>(`/chat/${sessionId}`, { message, userId }),
    cancel: (sessionId: string) => apiPost<{ success: boolean }>(`/chat/${sessionId}/cancel`),
    running: (sessionId: string) => apiGet<{ running: boolean }>(`/chat/${sessionId}/running`),
  },

  agents: {
    list: () => apiGet<{ agents: AgentInfo[] }>('/agents'),
    register: (data: Record<string, unknown>) => apiPost<{ success: boolean; name: string }>('/agents/register', data),
    unregister: (name: string) => apiPost<{ success: boolean }>(`/agents/${name}/unregister`),
  },

  config: {
    list: () => apiGet<{ entries: Array<{ key: string; value: string; encrypted: boolean; description: string; category: string; masked: string }> }>('/config'),
    batch: (updates: Record<string, string>) => apiPost<{ success: boolean }>('/config/batch', updates),
    reload: () => apiPost<{ success: boolean }>('/config/reload'),
    reset: () => apiPost<{ success: boolean }>('/config/reset'),
  },

  feishu: {
    status: () => apiGet<{ connected: boolean; configured: boolean }>('/feishu/status'),
    test: () => apiPost<{ success: boolean; message: string }>('/feishu/test'),
    register: () => apiPost<{ success: boolean; deviceCode: string; qrUrl: string }>('/feishu/register/init'),
  },
};
