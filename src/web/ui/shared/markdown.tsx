import { h } from 'preact';
import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

interface Props {
  content: string;
}

export function Markdown({ content }: Props) {
  const html = marked.parse(content) as string;

  return (
    <div
      class="markdown-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
