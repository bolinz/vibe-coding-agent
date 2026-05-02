import { h, type ComponentChildren } from 'preact';

interface Props {
  title: string;
  children: ComponentChildren;
}

export function ConfigSection({ title, children }: Props) {
  return (
    <div class="config-section">
      <div class="config-section-header">{title}</div>
      {children}
    </div>
  );
}
