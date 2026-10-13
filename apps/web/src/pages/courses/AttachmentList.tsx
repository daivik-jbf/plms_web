import type { Attachment, AttachmentKind } from '../../api/courses';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { MoveButton } from '../../components/MoveButton';
import { Table } from '../../components/Table';
import { useMoveFocus } from '../../components/use-move-focus';
import { formatBytes, formatDuration } from '../../lib/format';
import { CATEGORIES } from '../../media/categories';
import media from '../media/Media.module.css';
import hub from './CoursesHub.module.css';

interface AttachmentListProps {
  attachments: Attachment[];
  busy: boolean;
  // Percent sent for attachments being uploaded from this browser right now, by attachment id.
  progress: Record<string, number>;
  onOpen: (attachment: Attachment) => void;
  onEdit: (attachment: Attachment) => void;
  // Given only to Admins: the Delete button appears on a file when this is given.
  onDelete?: (attachment: Attachment) => void;
  onMove: (attachment: Attachment, delta: -1 | 1) => void;
}

const KIND_WORDS: Record<AttachmentKind, string> = { video: 'Video', audio: 'Audio', pdf: 'PDF', image: 'Image' };
const KIND_GLYPHS: Record<AttachmentKind, string> = { video: '▶', audio: '♪', pdf: '≣', image: '▣' };

// Where a library attachment comes from, in the words of the library: "Songs › Road trip".
function sourceText(attachment: Attachment): string | null {
  if (attachment.source !== 'library') return null;
  const category = CATEGORIES.find((candidate) => candidate.noun === attachment.category);
  return `From ${category?.label ?? 'the library'} › ${attachment.libraryFolderName ?? ''}`;
}

export function AttachmentList({ attachments, busy, progress, onOpen, onEdit, onMove, onDelete }: AttachmentListProps) {
  // Only ready attachments can be ordered; one that is still uploading keeps its place until it finishes.
  const moveFocus = useMoveFocus(busy);
  const ready = attachments.filter((attachment) => attachment.status === 'ready');

  return (
    <div {...moveFocus}>
    <Table caption="Attachments">
      <thead>
        <tr>
          <th scope="col">Attachment</th>
          <th scope="col">Type</th>
          <th scope="col">Length</th>
          <th scope="col">Size</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {attachments.map((attachment) => {
          const isReady = attachment.status === 'ready';
          const readyIndex = ready.indexOf(attachment);
          const source = sourceText(attachment);
          const percent = progress[attachment.id];
          return (
            <tr key={attachment.id}>
              <td data-label="Attachment">
                <div className={media.itemCell}>
                  {attachment.thumbnailUrl ? (
                    <img className={media.cover} src={attachment.thumbnailUrl} alt="" loading="lazy" />
                  ) : (
                    <span className={media.coverPlaceholder} aria-hidden="true">
                      {isReady ? KIND_GLYPHS[attachment.kind] : '⏳'}
                    </span>
                  )}
                  <div>
                    <span className={media.name}>{attachment.title}</span>
                    {source ? <span className={media.muted}>{source}</span> : null}
                    {attachment.description ? <span className={`${media.muted} ${hub.clamp}`}>{attachment.description}</span> : null}
                    {isReady ? null : <Badge tone="change">{percent === undefined ? 'Uploading' : `Uploading ${percent}%`}</Badge>}
                  </div>
                </div>
              </td>
              <td data-label="Type">{KIND_WORDS[attachment.kind]}</td>
              <td data-label="Length">{isReady && (attachment.kind === 'video' || attachment.kind === 'audio') ? formatDuration(attachment.durationSeconds) : '—'}</td>
              <td data-label="Size">{formatBytes(attachment.sizeBytes)}</td>
              <td data-label="Actions">
                {isReady ? (
                  <div className={media.actions}>
                    <Button size="small" aria-label={`Open ${attachment.title}`} onClick={() => onOpen(attachment)}>
                      Open
                    </Button>
                    <Button variant="secondary" size="small" disabled={busy} aria-label={`Edit ${attachment.title}`} onClick={() => onEdit(attachment)}>
                      Edit
                    </Button>
                    <MoveButton className={hub.square} moveKey={`${attachment.id}:up`} label={`Move ${attachment.title} up`} unavailable={busy || readyIndex === 0} onMove={() => onMove(attachment, -1)}>
                      <Icon name="up" size={16} />
                    </MoveButton>
                    <MoveButton className={hub.square} moveKey={`${attachment.id}:down`} label={`Move ${attachment.title} down`} unavailable={busy || readyIndex === ready.length - 1} onMove={() => onMove(attachment, 1)}>
                      <Icon name="down" size={16} />
                    </MoveButton>
                    {onDelete ? (
                      <Button variant="secondary" size="small" className={hub.square} disabled={busy} aria-label={`Delete ${attachment.title}`} title="Delete" onClick={() => onDelete(attachment)}>
                        <Icon name="trash" size={16} />
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
    </div>
  );
}
