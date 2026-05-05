import { render, h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { api } from '../../shared/api';
import type { SessionData, MessageData, SSEMessage } from '../../shared/types';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { ChatArea } from './ChatArea';
import { InputBar } from './InputBar';

const USER_ID = localStorage.getItem('userId') || crypto.randomUUID?.() || `user_${Math.random().toString(36).substring(2, 8)}`;
localStorage.setItem('userId', USER_ID);

function ChatApp() {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(localStorage.getItem('sessionId'));
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [connStatus, setConnStatus] = useState<'on' | 'ws' | 'off'>('off');
  const [isRunning, setIsRunning] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [typingText, setTypingText] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [agents, setAgents] = useState<string[]>([]);
  const sseRef = useRef<EventSource | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const shouldUseSSE = useRef(true);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.sessions.list();
      setSessions(data.sessions || []);
    } catch (e) {
      console.warn('load sessions failed', e);
    }
  }, []);

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const data = await api.sessions.get(sessionId);
      setMessages(data.messages || []);
    } catch {
      setMessages([]);
    }
  }, []);

  const switchSession = useCallback(async (sessionId: string) => {
    setCurrentSessionId(sessionId);
    localStorage.setItem('sessionId', sessionId);
    connectSSE(sessionId);
    await loadMessages(sessionId);
  }, [loadMessages]);

  const createNewSession = useCallback(async () => {
    try {
      const data = await api.sessions.create(USER_ID);
      setCurrentSessionId(data.id);
      localStorage.setItem('sessionId', data.id);
      setMessages([]);
      loadSessions();
      connectSSE(data.id);
      setMessages([{ role: 'system', content: '新会话已创建，开始对话吧' }]);
    } catch (e) {
      console.error('create session failed', e);
    }
  }, [loadSessions]);

  // Setup SSE
  const connectSSE = useCallback((sessionId: string | null) => {
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    shouldUseSSE.current = true;
    if (!sessionId) return;

    const sse = new EventSource(`/api/chat/${sessionId}/sse`);
    sse.onmessage = (event) => {
      try {
        const data: SSEMessage = JSON.parse(event.data);
        if (data.type === 'thinking') {
          setTypingText('正在思考...');
          setIsRunning(true);
        } else if (data.type === 'tool_executing') {
          setTypingText(`正在执行: ${data.toolName || '工具'}`);
          setIsRunning(true);
        } else if (data.type === 'container_starting') {
          setTypingText(`容器启动中... (${data.content || ''})`);
          setIsRunning(true);
        } else if (data.type === 'stream_chunk') {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, content: last.content + (data.content || '') };
              return updated;
            }
            return [...prev, { role: 'assistant', content: data.content || '' }];
          });
        } else if (data.type === 'response') {
          setTypingText(null);
          setIsRunning(false);
          setMessages(prev => [...prev, { role: 'assistant', content: data.content || '' }]);
          loadSessions();
        } else if (data.type === 'error') {
          setTypingText(null);
          setIsRunning(false);
          setMessages(prev => [...prev, { role: 'system', content: `错误: ${data.content}` }]);
        }
      } catch {}
    };
    sse.onopen = () => setConnStatus('on');
    sse.onerror = () => {
      sse.close();
      sseRef.current = null;
      shouldUseSSE.current = false;
      setConnStatus('off');
      connectWS(sessionId);
    };
    sseRef.current = sse;
  }, [loadSessions]);

  const connectWS = useCallback((sessionId: string) => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws?sessionId=${sessionId}`);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'response') {
          setTypingText(null);
          setIsRunning(false);
          setMessages(prev => [...prev, { role: 'assistant', content: data.content }]);
        }
      } catch {}
    };
    ws.onopen = () => setConnStatus('ws');
    ws.onclose = () => setConnStatus('off');
    wsRef.current = ws;
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!currentSessionId || isSending) return;
    setIsSending(true);
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setTypingText('正在思考...');
    setIsRunning(true);

    try {
      if (shouldUseSSE.current) {
        await api.chat.send(currentSessionId, text, USER_ID);
      } else if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ sessionId: currentSessionId, message: text, userId: USER_ID }));
      } else {
        setMessages(prev => [...prev, { role: 'system', content: '未连接，无法发送' }]);
        setTypingText(null);
        setIsRunning(false);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'system', content: '发送失败' }]);
      setTypingText(null);
      setIsRunning(false);
    }
    setIsSending(false);
  }, [currentSessionId, isSending]);

  const cancelRequest = useCallback(async () => {
    if (!currentSessionId) return;
    try { await api.chat.cancel(currentSessionId); } catch {}
    setTypingText(null);
    setIsRunning(false);
    setMessages(prev => [...prev, { role: 'system', content: '已取消' }]);
  }, [currentSessionId]);

  // Init
  useEffect(() => {
    loadSessions().then(() => {
      if (currentSessionId) {
        loadMessages(currentSessionId);
        connectSSE(currentSessionId);
      } else {
        createNewSession();
      }
    });
    api.agents.list().then(data => setAgents((data.agents || []).map(a => a.name))).catch(() => {});
  }, []);

  useEffect(() => {
    if (currentSessionId) connectSSE(currentSessionId);
  }, [currentSessionId]);

  // Background refresh
  useEffect(() => {
    const interval = setInterval(() => loadSessions(), 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style="height:100vh;display:flex;flex-direction:column;">
      <Header
        connStatus={connStatus}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(v => !v)}
      />
      <div class="chat-layout">
        <Sidebar
          collapsed={sidebarCollapsed}
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSwitch={switchSession}
          onCreate={createNewSession}
          onSessionsChange={loadSessions}
          agentNames={agents}
        />
        <div class="chat-area">
          <ChatArea
            messages={messages}
            typingText={typingText}
            onCreateSession={createNewSession}
          />
          <InputBar
            onSend={sendMessage}
            onCancel={cancelRequest}
            isSending={isSending}
            isRunning={isRunning}
          />
        </div>
      </div>
    </div>
  );
}

// Mount
const root = document.getElementById('app');
if (root) render(h(ChatApp, {}), root);
