import { h } from 'preact';
import { useRef, useEffect, useState } from 'preact/hooks';
import type { MessageData } from '../../shared/types';
import { MessageList } from './MessageList';

interface Props {
  messages: MessageData[];
  typingText: string | null;
}

export function ChatArea({ messages, typingText }: Props) {
  const [nearBottom, setNearBottom] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    const container = containerRef.current?.querySelector('.chat-container');
    if (container) container.scrollTop = container.scrollHeight;
  };

  const handleScroll = () => {
    const container = containerRef.current?.querySelector('.chat-container');
    if (!container) return;
    const near = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    setNearBottom(near);
  };

  return (
    <div ref={containerRef} style="flex:1;display:flex;flex-direction:column;position:relative;overflow:hidden;">
      <div style="flex:1;overflow-y:auto;" onScroll={handleScroll}>
        <MessageList messages={messages} typingText={typingText} />
      </div>
      <button
        id="scrollBottomBtn"
        class={nearBottom ? '' : 'visible'}
        onClick={scrollToBottom}
        title="滚动到底部"
      >
        ↓
      </button>
    </div>
  );
}
