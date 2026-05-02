import { h } from 'preact';
import { RotateCcw, Save, Check } from 'lucide-preact';

interface Props {
  saving: boolean;
  saved: boolean;
  onSave: () => Promise<void>;
  onReset: () => Promise<void>;
}

export function ActionBar({ saving, saved, onSave, onReset }: Props) {
  return (
    <div class="config-action-bar">
      <button class="btn-config-reset" onClick={onReset}>
        <RotateCcw size={14} />
        重置
      </button>
      <button class={`btn-config-save${saved ? ' saved' : ''}`} onClick={onSave} disabled={saving}>
        {saved ? <Check size={14} /> : <Save size={14} />}
        {saving ? '保存中...' : saved ? '已保存' : '保存配置'}
      </button>
    </div>
  );
}
