import { h } from 'preact';

interface Props {
  entry: {
    key: string;
    value: string;
    encrypted: boolean;
    description: string;
  };
}

export function ConfigRow({ entry }: Props) {
  const needsRestart = entry.key === 'port' || entry.key === 'host' || entry.key === 'redis_url';
  const inputType = entry.encrypted ? 'password' : 'text';

  return (
    <div class="config-row">
      <div>
        <div class="config-row-label">{entry.key}</div>
        <div class="config-row-desc">
          {entry.description}
          {needsRestart && <span class="restart-tag">需重启</span>}
        </div>
      </div>
      <div class="config-row-input" style="display:flex;align-items:center;gap:0.4rem;">
        <input
          type={inputType}
          id={`cfg-${entry.key}`}
          defaultValue={entry.value}
          data-key={entry.key}
          data-encrypted={entry.encrypted ? 'true' : 'false'}
        />
        {entry.encrypted && (
          <button
            class="toggle-vis"
            onClick={(e) => {
              const btn = e.target as HTMLElement;
              const input = btn.previousElementSibling as HTMLInputElement;
              input.type = input.type === 'password' ? 'text' : 'password';
            }}
          >
            👁
          </button>
        )}
      </div>
    </div>
  );
}
