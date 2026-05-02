import { render, h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { api } from '../../shared/api';
import { ConfigSection } from './ConfigSection';
import { ConfigRow } from './ConfigRow';
import { ArrowLeft } from 'lucide-preact';
import { NavSidebar } from './NavSidebar';
import { FeishuCard } from './FeishuCard';
import { ActionBar } from './ActionBar';

type Category = 'ai' | 'agent' | 'channel' | 'system';

interface ConfigEntry {
  key: string;
  value: string;
  encrypted: boolean;
  description: string;
  category: string;
  masked: string;
}

const CATEGORIES: Array<{ id: Category; icon: string; label: string }> = [
  { id: 'ai', icon: 'bot', label: 'AI' },
  { id: 'agent', icon: 'settings', label: 'Agent' },
  { id: 'channel', icon: 'link', label: '通道' },
  { id: 'system', icon: 'monitor', label: '系统' },
];

function ConfigApp() {
  const [activeTab, setActiveTab] = useState<Category>('ai');
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [feishuConnected, setFeishuConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [feishuSSE, setFeishuSSE] = useState<EventSource | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const data = await api.config.list();
      setEntries(data.entries || []);
    } catch (e) {
      console.error('load config failed', e);
    }
  }, []);

  const loadFeishuStatus = useCallback(async () => {
    try {
      const status = await api.feishu.status();
      setFeishuConnected(status.connected);
    } catch {}
  }, []);

  useEffect(() => {
    loadConfig();
    loadFeishuStatus();
  }, []);

  const grouped = entries.reduce<Record<string, ConfigEntry[]>>((acc, e) => {
    if (!acc[e.category]) acc[e.category] = [];
    acc[e.category].push(e);
    return acc;
  }, {});

  const handleSave = async (values: Record<string, string>) => {
    setSaving(true);
    try {
      await api.config.batch(values);
      await api.config.reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      loadConfig();
    } catch (e) {
      console.error('save failed', e);
    }
    setSaving(false);
  };

  const collectValues = (): Record<string, string> => {
    const values: Record<string, string> = {};
    document.querySelectorAll<HTMLInputElement>('#config-content input[data-key]').forEach(input => {
      values[input.dataset.key!] = input.value;
    });
    return values;
  };

  return (
    <div class="config-app">
      <header class="config-header">
        <a href="/" class="back-link"><ArrowLeft size={14} /> 返回 Chat</a>
        <h1>系统配置</h1>
      </header>
      <div class="config-body">
        <NavSidebar
          categories={CATEGORIES}
          activeTab={activeTab}
          onSelect={(id) => setActiveTab(id as Category)}
        />
        <div class="config-content" id="config-content">
          {CATEGORIES.map(cat => (
            <div style={{ display: activeTab === cat.id ? 'block' : 'none' }}>
              <ConfigSection title={cat.label}>
                {grouped[cat.id]?.map(entry => (
                  <ConfigRow key={entry.key} entry={entry} />
                ))}
                {cat.id === 'channel' && (
                  <FeishuCard
                    connected={feishuConnected}
                    onStatusChange={loadFeishuStatus}
                    feishuSSE={feishuSSE}
                    setFeishuSSE={setFeishuSSE}
                  />
                )}
              </ConfigSection>
            </div>
          ))}
        </div>
      </div>
      <ActionBar
        saving={saving}
        saved={saved}
        onSave={() => handleSave(collectValues())}
        onReset={async () => {
          if (!confirm('确定要重置所有配置为默认值吗？')) return;
          try {
            await api.config.reset();
            loadConfig();
          } catch {}
        }}
      />
      <div class="config-toast" id="config-toast"></div>
    </div>
  );
}

const root = document.getElementById('config-app');
if (root) render(h(ConfigApp, {}), root);
