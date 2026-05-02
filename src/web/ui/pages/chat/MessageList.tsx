import { h } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import type { MessageData } from '../../shared/types';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { WelcomeScreen } from './WelcomeScreen';

interface Props {
  messages: MessageData[];
  typingText: string | null;
  onCreateSession: () => Promise<void>;
}

export function MessageList({ messages, typingText, onCreateSession }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingText]);

  if (messages.length === 0 && !typingText) {
    return <WelcomeScreen onCreateSession={onCreateSession} />;
  }

  return (
    <div>
      {messages.map((m, i) => (
        <MessageBubble key={i} message={m} />
      ))}
      {typingText && <TypingIndicator text={typingText} />}
      <div ref={bottomRef} />
    </div>
  );
}
