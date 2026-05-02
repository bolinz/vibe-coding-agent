import { h } from 'preact';
import { useState } from 'preact/hooks';
import { Copy, Check } from 'lucide-preact';
import { Markdown } from '../../shared/markdown';
import type { MessageData } from '../../shared/types';
import { formatTimeShort } from '../../shared/utils';

interface Props {
  message: MessageData;
}

export function MessageBubble({ message }: Props) {
  const [copied, setCopied] = useState(false);

  if (message.role === 'system' || message.role === 'error') {
    return <div class={`message ${message.role}`}>{message.content}</div>;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const avatar = message.role === 'user' ? 'U' : 'A';

  return (
    <div class={`msg-with-avatar ${message.role}`}>
      <div class="msg-avatar">{avatar}</div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.125rem;">
          <span style="font-size:0.6875rem;font-weight:600;color:var(--text-secondary);">
            {message.role === 'user' ? 'You' : 'Assistant'}
          </span>
          {message.timestamp && (
            <span style="font-size:0.625rem;color:var(--text-muted);">
              {formatTimeShort(message.timestamp)}
            </span>
          )}
        </div>
        <div class={`message ${message.role}`}>
          <Markdown content={message.content} />
          <button
            class="msg-copy"
            onClick={handleCopy}
            title="复制"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
    </div>
  );
}
