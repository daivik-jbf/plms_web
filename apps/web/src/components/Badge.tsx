import type { ReactNode } from 'react';
import styles from './Badge.module.css';

export function Badge({ tone, children }: { tone: 'change' | 'danger' | 'warning' | 'success' | 'neutral'; children: ReactNode }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
