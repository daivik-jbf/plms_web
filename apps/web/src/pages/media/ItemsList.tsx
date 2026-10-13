import type { MediaItem } from '../../api/media';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { MoveButton } from '../../components/MoveButton';
import { formatBytes, formatDate, formatDuration } from '../../lib/format';
import type { CategoryConfig } from '../../media/categories';
import hub from '../courses/CoursesHub.module.css';
import styles from './Media.module.css';

interface ItemsListProps {
  category: CategoryConfig;
  items: MediaItem[];
  busy: boolean;
  // Percent sent for items being uploaded from this browser right now, by item id.
  progress: Record<string, number>;
  onPlay: (item: MediaItem) => void;
  onEdit: (item: MediaItem) => void;
  onMove: (item: MediaItem, delta: -1 | 1) => void;
}

// The items of a folder, one card each: the cover, the title, what it is, and the buttons that act on it.
export function ItemsList({ category, items, busy, progress, onPlay, onEdit, onMove }: ItemsListProps) {
  // Only ready items can be ordered; an item that is still uploading keeps its place until it finishes.
  const ready = items.filter((item) => item.status === 'ready');
  // Video cards open the pop-up from the title or anywhere on the card. Audio cards have a Play button for the docked
  // player instead, so a stray click on a card never starts sound.
  const isVideo = category.kind === 'video';

  return (
    <ul className={styles.items} aria-label={`${category.label} in this folder`}>
      {items.map((item) => {
        const isReady = item.status === 'ready';
        const opensOnClick = isReady && isVideo;
        const readyIndex = ready.indexOf(item);
        const percent = progress[item.id];
        return (
          <li key={item.id} className={opensOnClick ? `${styles.item} ${styles.clickable}` : styles.item} onClick={opensOnClick ? () => onPlay(item) : undefined}>
            {item.coverUrl ? (
              <img className={styles.itemCover} src={item.coverUrl} alt="" loading="lazy" />
            ) : (
              <span className={styles.itemCoverPlaceholder} aria-hidden="true">
                <Icon name={isReady ? category.icon : 'clock'} size={26} />
              </span>
            )}
            <div className={styles.itemText}>
              {opensOnClick ? (
                <button type="button" className={styles.itemTitle} onClick={() => onPlay(item)}>
                  {item.title}
                </button>
              ) : (
                <span className={styles.itemTitle}>{item.title}</span>
              )}
              {isReady ? (
                <span className={styles.itemMeta}>
                  {formatDuration(item.durationSeconds)} · {formatBytes(item.sizeBytes)} · {item.createdBy.name} · {formatDate(item.createdAt)}
                </span>
              ) : (
                <span className={styles.itemMeta}>
                  <Badge tone="change">{percent === undefined ? 'Uploading' : `Uploading ${percent}%`}</Badge>
                </span>
              )}
            </div>
            {isReady ? (
              <div className={styles.itemActions} onClick={(event) => event.stopPropagation()}>
                {isVideo ? null : (
                  <Button className={hub.addButton} size="small" aria-label={`Play ${item.title}`} onClick={() => onPlay(item)}>
                    <Icon name="songs" size={16} />
                    Play
                  </Button>
                )}
                <Button variant="secondary" size="small" className={hub.square} disabled={busy} aria-label={`Edit ${item.title}`} title="Edit" onClick={() => onEdit(item)}>
                  <Icon name="edit" size={16} />
                </Button>
                <MoveButton className={hub.square} moveKey={`${item.id}:up`} label={`Move ${item.title} up`} unavailable={busy || readyIndex === 0} onMove={() => onMove(item, -1)}>
                  <Icon name="up" size={16} />
                </MoveButton>
                <MoveButton className={hub.square} moveKey={`${item.id}:down`} label={`Move ${item.title} down`} unavailable={busy || readyIndex === ready.length - 1} onMove={() => onMove(item, 1)}>
                  <Icon name="down" size={16} />
                </MoveButton>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
