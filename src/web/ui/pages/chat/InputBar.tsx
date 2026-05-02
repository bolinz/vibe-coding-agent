import { h } from 'preact';
import { SendHorizonal, Square } from 'lucide-preact';
import { useState, useRef } from 'preact/hooks';

interface Props {
  onSend: (text: string) => Promise<void>;
  onCancel: () => Promise<void>;
  isSending: boolean;
  isRunning: boolean;
}

export function InputBar({ onSend, isSending, isRunning, onCancel }: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    setText('');
    await onSend(trimmed);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div class="input-area">
      <div class="input-container">
        {isRunning && (
          <button id="cancelBtn" onClick={onCancel} title="取消">
            <Square size={14} />
          </button>
        )}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          disabled={isSending}
          autocomplete="off"
        />
        <button id="sendBtn" onClick={handleSend} disabled={isSending || !text.trim()}>
          <SendHorizonal size={14} />
          {isSending ? '发送中' : '发送'}
        </button>
      </div>
    </div>
  );
}
