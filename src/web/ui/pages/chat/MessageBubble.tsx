import { h } from 'preact';
import type { MessageData } from '../../shared/types';
import { formatTimeShort } from '../../shared/utils';

interface Props {
  message: MessageData;
}

export function MessageBubble({ message }: Props) {
  if (message.role === 'system' || message.role === 'error') {
    return (
      <div class={`message ${message.role}`}>
        {message.content}
      </div>
    );
  }

  const avatar = message.role === 'user' ? 'U' : 'A';
  const avClass = message.role === 'user' ? 'user-av' : 'assistant-av';

  return (
    <div class={`msg-with-avatar ${message.role}`}>
      <div class={`msg-avatar ${avClass}`}>{avatar}</div>
      <div style="flex:1;min-width:0;">
        <div class={`message ${message.role}`}>
          {message.content}
        </div>
        {message.timestamp && (
          <div class="msg-time">{formatTimeShort(message.timestamp)}</div>
        )}
      </div>
    </div>
  );
}
