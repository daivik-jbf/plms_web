import styles from './CurrentCover.module.css';

// The cover an item already has, shown above its file picker in an edit dialog (a file input cannot be pre-filled).
export function CurrentCover({ url }: { url: string | null }) {
  return url ? <img className={styles.cover} src={url} alt="The current cover" /> : null;
}
