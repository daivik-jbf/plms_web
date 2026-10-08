import type { ReactNode } from 'react';
import styles from './AuthLayout.module.css';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.layout}>
      <aside className={styles.brand}>
        <p className={styles.wordmark}>JBF Learning Management System</p>
        <p className={styles.tagline}>Courses, video, film, podcasts and music, all in one place.</p>
      </aside>
      <main className={styles.main}>
        <div className={styles.panel}>
          <h1>{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}
