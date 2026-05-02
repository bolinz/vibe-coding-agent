import { h } from 'preact';
import { Bot, Settings, Link, Monitor } from 'lucide-preact';

interface Category {
  id: string;
  icon: string;
  label: string;
}

const ICON_MAP: Record<string, any> = {
  ai: Bot,
  agent: Settings,
  channel: Link,
  system: Monitor,
};

interface Props {
  categories: Category[];
  activeTab: string;
  onSelect: (id: string) => void;
}

export function NavSidebar({ categories, activeTab, onSelect }: Props) {
  return (
    <nav class="config-nav">
      {categories.map(cat => {
        const IconComp = ICON_MAP[cat.id] || Settings;
        return (
          <div
            class={`config-nav-item${activeTab === cat.id ? ' active' : ''}`}
            onClick={() => onSelect(cat.id)}
          >
            <IconComp size={16} />
            {cat.label}
          </div>
        );
      })}
    </nav>
  );
}
