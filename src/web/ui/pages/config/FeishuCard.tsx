import { h } from 'preact';

interface Props {
  connected: boolean;
  onStatusChange: () => Promise<void>;
  feishuSSE: EventSource | null;
  setFeishuSSE: (sse: EventSource | null) => void;
}

declare function toast(msg: string): void;

export function FeishuCard({ connected, onStatusChange, feishuSSE, setFeishuSSE }: Props) {
  const handleRegister = async () => {
    if (feishuSSE) { feishuSSE.close(); setFeishuSSE(null); }
    try {
      const data = await (await fetch('/api/feishu/register/init', { method: 'POST' })).json();
      if (!data.success) return;
      // Create SSE for registration
      const sse = new EventSource(`/api/feishu/register/${encodeURIComponent(data.deviceCode)}/sse`);
      sse.onmessage = async (event) => {
        const reg = JSON.parse(event.data);
        if (reg.done) { sse.close(); setFeishuSSE(null); return; }
        if (reg.status === 'success') {
          sse.close(); setFeishuSSE(null);
          const appIdInput = document.getElementById('cfg-feishu_app_id') as HTMLInputElement;
          const appSecretInput = document.getElementById('cfg-feishu_app_secret') as HTMLInputElement;
          if (appIdInput) appIdInput.value = reg.appId || '';
          if (appSecretInput) appSecretInput.value = reg.appSecret || '';
          await fetch('/api/config/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feishu_app_id: reg.appId || '', feishu_app_secret: reg.appSecret || '' }) });
          await fetch('/api/config/reload', { method: 'POST' });
          onStatusChange();
        }
      };
      setFeishuSSE(sse);
    } catch (e) {
      console.error('feishu register error', e);
    }
  };

  const handleTest = async () => {
    try {
      const res = await (await fetch('/api/feishu/test', { method: 'POST' })).json();
      onStatusChange();
    } catch {}
  };

  return (
    <div class="feishu-card">
      <div class="feishu-card-row">
        <div class="feishu-qr-box" id="feishu-register-qr">
          点击下方按钮生成二维码
        </div>
        <div class="feishu-info">
          <div class={`feishu-status-badge ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? '● 已连接' : '○ 未连接'}
          </div>
          <div style="font-size:0.8rem;color:#666688;line-height:1.6;">
            <div>步骤: 1. 点击扫码创建 2. 用飞书 App 扫码</div>
            <div>3. 授权后自动填入凭证 4. 点击测试连接验证</div>
          </div>
          <div class="feishu-actions">
            <button class="btn-scan" onClick={handleRegister}>📷 扫码创建机器人</button>
            <button class="btn-test" onClick={handleTest}>🔌 测试连接</button>
          </div>
          <div id="feishu-test-result" class="feishu-test-result"></div>
        </div>
      </div>
    </div>
  );
}
