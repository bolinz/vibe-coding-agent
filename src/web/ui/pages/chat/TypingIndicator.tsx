import { h } from 'preact';

interface Props {
  text: string;
}

export function TypingIndicator({ text }: Props) {
  return (
    <div class="typing">
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
      <span class="typing-status">{text}</span>
    </div>
  );
}
