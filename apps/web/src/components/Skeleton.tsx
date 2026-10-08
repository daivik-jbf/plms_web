import styles from './Skeleton.module.css';

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className={styles.box}>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className={styles.bar} />
      ))}
      {/* Some screen readers do not announce a status region's aria-label, so the word is also there as text. */}
      <span className={styles.srOnly}>Loading</span>
    </div>
  );
}
