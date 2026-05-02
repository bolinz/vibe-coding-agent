import { h } from 'preact';
import { useState } from 'preact/hooks';
import { Eye, EyeOff } from 'lucide-preact';

interface ConfigEntry {
  key: string;
  value: string;
  encrypted: boolean;
  description: string;
  category: string;
  masked: string;
}

interface Props {
  entry: ConfigEntry;
}

export function ConfigRow({ entry }: Props) {
  const [showPW, setShowPW] = useState(false);
  const isPassword = entry.encrypted;

  return (
    <div class="config-row">
      <div>
        <div class="config-row-label">{entry.key}</div>
        {entry.description && <div class="config-row-desc">{entry.description}</div>}
      </div>
      <div class="config-row-input" style="display:flex;align-items:center;gap:0.375rem;">
        <input
          type={isPassword && !showPW ? 'password' : 'text'}
          data-key={entry.key}
          defaultValue={isPassword ? entry.value : entry.value}
          placeholder={entry.key}
        />
        {isPassword && (
          <button class="toggle-vis" onClick={() => setShowPW(v => !v)} title={showPW ? '隐藏' : '显示'}>
            {showPW ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        {(entry.key.includes('port') || entry.key.includes('redis') || entry.key.includes('listen')) && (
          <span class="restart-tag">需重启</span>
        )}
      </div>
    </div>
  );
}
