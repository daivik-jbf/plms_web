import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';
import styles from './Tabs.module.css';

interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  label: string;
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
  children: ReactNode;
}

export function Tabs({ label, tabs, value, onChange, children }: TabsProps) {
  const base = useId();
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Alt/Ctrl/Cmd + arrow are browser and system shortcuts (Back, Forward, word jumps); leave them alone.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = tabs.findIndex((tab) => tab.id === value);
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[next]!;
    onChange(target.id);
    buttons.current[target.id]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className={styles.list} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(element) => {
              buttons.current[tab.id] = element;
            }}
            role="tab"
            type="button"
            id={`${base}-tab-${tab.id}`}
            aria-selected={tab.id === value}
            aria-controls={`${base}-panel`}
            tabIndex={tab.id === value ? 0 : -1}
            className={`${styles.tab} ${tab.id === value ? styles.selected : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.count === undefined ? tab.label : `${tab.label} (${tab.count})`}
          </button>
        ))}
      </div>
      <div role="tabpanel" tabIndex={0} id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`} className={styles.panel}>
        {children}
      </div>
    </div>
  );
}
