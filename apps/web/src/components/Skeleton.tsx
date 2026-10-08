import styles from './Skeleton.module.css';

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className={styles.box}>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className={styles.bar} />
      ))}
    </div>
  );
}
