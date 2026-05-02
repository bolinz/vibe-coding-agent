import { h } from 'preact';

interface Props {
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  onReset: () => void;
}

export function ActionBar({ saving, saved, onSave, onReset }: Props) {
  return (
    <div class="config-action-bar">
      <button class="btn-config-reset" onClick={onReset}>↺ 重置为默认</button>
      <button
        class={`btn-config-save${saved ? ' saved' : ''}`}
        onClick={onSave}
        disabled={saving}
      >
        {saving ? '⏳ 保存中...' : saved ? '✓ 已保存' : '💾 保存配置'}
      </button>
    </div>
  );
}
