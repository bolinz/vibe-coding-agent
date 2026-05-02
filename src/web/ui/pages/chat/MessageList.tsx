import { h } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import type { MessageData } from '../../shared/types';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';

interface Props {
  messages: MessageData[];
  typingText: string | null;
}

export function MessageList({ messages, typingText }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingText]);

  return (
    <div class="chat-container" id="chat">
      {messages.length === 0 && (
        <div class="message system">新会话已创建，开始对话吧</div>
      )}
      {messages.map((m, i) => (
        <MessageBubble key={i} message={m} />
      ))}
      {typingText && <TypingIndicator text={typingText} />}
      <div ref={bottomRef} />
    </div>
  );
}
