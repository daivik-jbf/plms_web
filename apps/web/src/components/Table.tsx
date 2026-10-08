import type { ReactNode } from 'react';
import styles from './Table.module.css';

// Cells carry data-label="Column name" so each row can stack into labelled lines on a phone.
export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <caption className={styles.caption}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}
