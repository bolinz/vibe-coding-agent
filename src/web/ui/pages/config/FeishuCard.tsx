import { h } from 'preact';
import { CheckCircle, XCircle, RefreshCw, QrCode } from 'lucide-preact';
import { useState, useEffect } from 'preact/hooks';
import { api } from '../../shared/api';

interface Props {
  connected: boolean;
  onStatusChange: () => Promise<void>;
  feishuSSE: EventSource | null;
  setFeishuSSE: (sse: EventSource | null) => void;
}

export function FeishuCard({ connected, onStatusChange, feishuSSE, setFeishuSSE }: Props) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.feishu.test();
      setTestResult(result.success ? '连接正常' : `失败: ${result.message}`);
    } catch (e: any) {
      setTestResult(`错误: ${e.message}`);
    }
    setTesting(false);
  };

  const handleScan = async () => {
    try {
      const result = await api.feishu.register();
      if (result.qrUrl) {
        window.open(result.qrUrl, '_blank');
      }
    } catch {}
  };

  return (
    <div class="feishu-card">
      <div class="feishu-card-row">
        <div class="feishu-qr-box">
          <QrCode size={32} />
        </div>
        <div class="feishu-info">
          <div class={`feishu-status-badge ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {connected ? '已连接' : '未连接'}
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem;">
            飞书机器人接入
          </div>
          <div class="feishu-actions">
            <button class="btn-test" onClick={handleTest} disabled={testing}>
              <RefreshCw size={13} class={testing ? 'spinning' : ''} />
              {testing ? '测试中' : '测试连接'}
            </button>
            <button class="btn-scan" onClick={handleScan}>
              <QrCode size={13} />
              重新扫码
            </button>
          </div>
          {testResult && (
            <div class="feishu-test-result" style={{ color: testResult.includes('正常') ? 'var(--success)' : 'var(--danger)' }}>
              {testResult}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
