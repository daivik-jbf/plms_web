import type { MediaItem } from '../../api/media';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import { formatBytes, formatDate, formatDuration } from '../../lib/format';
import type { CategoryConfig } from '../../media/categories';
import styles from './Media.module.css';

interface ItemsTableProps {
  category: CategoryConfig;
  items: MediaItem[];
  busy: boolean;
  // Percent sent for items being uploaded from this browser right now, by item id.
  progress: Record<string, number>;
  onPlay: (item: MediaItem) => void;
  onEdit: (item: MediaItem) => void;
  onMove: (item: MediaItem, delta: -1 | 1) => void;
}

export function ItemsTable({ category, items, busy, progress, onPlay, onEdit, onMove }: ItemsTableProps) {
  // Only ready items can be ordered; an item that is still uploading keeps its place until it finishes.
  const ready = items.filter((item) => item.status === 'ready');
  // Video rows open the pop-up from the title or anywhere on the row. Audio rows have a Play button for the docked
  // player instead, so a stray click on a row never starts sound.
  const isVideo = category.kind === 'video';

  return (
    <Table caption={`${category.label} in this folder`}>
      <thead>
        <tr>
          <th scope="col">{category.nounTitle}</th>
          <th scope="col">Length</th>
          <th scope="col">Size</th>
          <th scope="col">Added</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const isReady = item.status === 'ready';
          const opensOnClick = isReady && isVideo;
          const readyIndex = ready.indexOf(item);
          const percent = progress[item.id];
          return (
            <tr key={item.id} className={opensOnClick ? styles.clickable : undefined} onClick={opensOnClick ? () => onPlay(item) : undefined}>
              <td data-label={category.nounTitle}>
                <div className={styles.itemCell}>
                  {item.coverUrl ? (
                    <img className={styles.cover} src={item.coverUrl} alt="" loading="lazy" />
                  ) : (
                    <span className={styles.coverPlaceholder} aria-hidden="true">
                      {!isReady ? '⏳' : isVideo ? '▶' : '♪'}
                    </span>
                  )}
                  <div>
                    {opensOnClick ? (
                      <button type="button" className={styles.titleButton} onClick={() => onPlay(item)}>
                        {item.title}
                      </button>
                    ) : (
                      <>
                        <span className={styles.name}>{item.title}</span>
                        {isReady ? null : <Badge tone="change">{percent === undefined ? 'Uploading' : `Uploading ${percent}%`}</Badge>}
                      </>
                    )}
                  </div>
                </div>
              </td>
              <td data-label="Length">{isReady ? formatDuration(item.durationSeconds) : '—'}</td>
              <td data-label="Size">{formatBytes(item.sizeBytes)}</td>
              <td data-label="Added">
                {item.createdBy.name} · {formatDate(item.createdAt)}
              </td>
              <td data-label="Actions" onClick={(event) => event.stopPropagation()}>
                {isReady ? (
                  <div className={styles.actions}>
                    {isVideo ? null : (
                      <Button size="small" aria-label={`Play ${item.title}`} onClick={() => onPlay(item)}>
                        Play
                      </Button>
                    )}
                    <Button variant="secondary" size="small" disabled={busy} aria-label={`Edit ${item.title}`} onClick={() => onEdit(item)}>
                      Edit
                    </Button>
                    <Button variant="secondary" size="small" disabled={busy || readyIndex === 0} aria-label={`Move ${item.title} up`} onClick={() => onMove(item, -1)}>
                      ↑ Move up
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={busy || readyIndex === ready.length - 1}
                      aria-label={`Move ${item.title} down`}
                      onClick={() => onMove(item, 1)}
                    >
                      ↓ Move down
                    </Button>
                  </div>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
