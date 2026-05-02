import { h } from 'preact';

interface Category {
  id: string;
  icon: string;
  label: string;
}

interface Props {
  categories: Category[];
  activeTab: string;
  onSelect: (id: string) => void;
}

export function NavSidebar({ categories, activeTab, onSelect }: Props) {
  return (
    <nav class="config-nav">
      {categories.map(cat => (
        <div
          class={`config-nav-item${activeTab === cat.id ? ' active' : ''}`}
          onClick={() => onSelect(cat.id)}
        >
          <span class="nav-icon">{cat.icon}</span>
          {cat.label}
        </div>
      ))}
    </nav>
  );
}
