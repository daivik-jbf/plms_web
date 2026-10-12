import type { Attachment, AttachmentKind } from '../../api/courses';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import { formatBytes, formatDuration } from '../../lib/format';
import { CATEGORIES } from '../../media/categories';
import media from '../media/Media.module.css';

interface AttachmentListProps {
  attachments: Attachment[];
  busy: boolean;
  onOpen: (attachment: Attachment) => void;
  onRename: (attachment: Attachment) => void;
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

export function AttachmentList({ attachments, busy, onOpen, onRename, onMove }: AttachmentListProps) {
  // Only ready attachments can be ordered; one that is still uploading keeps its place until it finishes.
  const ready = attachments.filter((attachment) => attachment.status === 'ready');

  return (
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
                    {isReady ? null : <Badge tone="change">Uploading</Badge>}
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
                    <Button variant="secondary" size="small" disabled={busy} aria-label={`Rename ${attachment.title}`} onClick={() => onRename(attachment)}>
                      Rename
                    </Button>
                    <Button variant="secondary" size="small" disabled={busy || readyIndex === 0} aria-label={`Move ${attachment.title} up`} onClick={() => onMove(attachment, -1)}>
                      ↑ Move up
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={busy || readyIndex === ready.length - 1}
                      aria-label={`Move ${attachment.title} down`}
                      onClick={() => onMove(attachment, 1)}
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
