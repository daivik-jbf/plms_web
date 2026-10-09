import type { MediaItem } from '../../api/media';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import { formatBytes, formatDate, formatDuration } from '../../lib/format';
import styles from './Media.module.css';

interface ItemsTableProps {
  items: MediaItem[];
  busy: boolean;
  // Percent sent for videos being uploaded from this browser right now, by item id.
  progress: Record<string, number>;
  onOpen: (item: MediaItem) => void;
  onEdit: (item: MediaItem) => void;
  onMove: (item: MediaItem, delta: -1 | 1) => void;
}

export function ItemsTable({ items, busy, progress, onOpen, onEdit, onMove }: ItemsTableProps) {
  // Only ready videos can be ordered; a video that is still uploading keeps its place until it finishes.
  const ready = items.filter((item) => item.status === 'ready');

  return (
    <Table caption="Videos in this folder">
      <thead>
        <tr>
          <th scope="col">Video</th>
          <th scope="col">Length</th>
          <th scope="col">Size</th>
          <th scope="col">Added</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const isReady = item.status === 'ready';
          const readyIndex = ready.indexOf(item);
          const percent = progress[item.id];
          return (
            <tr key={item.id} className={isReady ? styles.clickable : undefined} onClick={isReady ? () => onOpen(item) : undefined}>
              <td data-label="Video">
                <div className={styles.videoCell}>
                  {item.coverUrl ? (
                    <img className={styles.cover} src={item.coverUrl} alt="" loading="lazy" />
                  ) : (
                    <span className={styles.coverPlaceholder} aria-hidden="true">
                      {isReady ? '▶' : '⏳'}
                    </span>
                  )}
                  <div>
                    {isReady ? (
                      <button type="button" className={styles.titleButton} onClick={() => onOpen(item)}>
                        {item.title}
                      </button>
                    ) : (
                      <>
                        <span className={styles.name}>{item.title}</span>
                        <Badge tone="change">{percent === undefined ? 'Uploading' : `Uploading ${percent}%`}</Badge>
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
