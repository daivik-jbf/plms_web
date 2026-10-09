import { AUDIT_ACTIONS } from './audit.actions';
import { categoryOf, type PresentableEntry, presentAudit } from './audit-presentation';

const entry = (overrides: Partial<PresentableEntry>): PresentableEntry => ({
  action: 'x',
  source: 'portal',
  actorLabel: 'anita@example.org',
  actorName: 'Anita',
  targetLabel: null,
  targetName: null,
  changes: null,
  metadata: null,
  ...overrides,
});

describe('media audit presentation', () => {
  it.each([
    ['content.folder.created', { targetLabel: 'Safety' }, 'Folder created', 'change', 'content', 'Anita created the folder Safety'],
    [
      'content.folder.renamed',
      { targetLabel: 'Safety', changes: { name: { before: 'Safty', after: 'Safety' } } },
      'Folder renamed',
      'change',
      'content',
      'Anita renamed the folder from Safty to Safety',
    ],
    ['content.folder.renamed', { targetLabel: 'Safety' }, 'Folder renamed', 'change', 'content', 'Anita renamed the folder Safety'],
    ['content.folder.reordered', {}, 'Folders reordered', 'neutral', 'content', 'Anita changed the order of the video folders'],
    ['content.video.added', { targetLabel: 'Fire exits' }, 'Video added', 'change', 'content', 'Anita added the video Fire exits'],
    ['content.video.edited', { targetLabel: 'Fire exits' }, 'Video edited', 'change', 'content', 'Anita edited the video Fire exits'],
    [
      'content.video.reordered',
      { targetLabel: 'Safety' },
      'Videos reordered',
      'neutral',
      'content',
      'Anita changed the order of the videos in Safety',
    ],
    ['content.video.cover_set', { targetLabel: 'Fire exits' }, 'Cover set', 'change', 'content', 'Anita set the cover image of Fire exits'],
    ['file.upload_started', { targetLabel: 'Fire exits' }, 'Upload started', 'neutral', 'files', 'Anita started uploading Fire exits'],
    ['file.upload_completed', { targetLabel: 'Fire exits' }, 'Upload finished', 'success', 'files', 'Anita finished uploading Fire exits'],
    [
      'file.upload_failed',
      { targetLabel: 'Fire exits', metadata: { reason: 'size_mismatch' } },
      'Upload failed',
      'warning',
      'files',
      'The upload of Fire exits failed (the file size did not match)',
    ],
    ['file.upload_cancelled', { targetLabel: 'Fire exits' }, 'Upload cancelled', 'neutral', 'files', 'Anita cancelled the upload of Fire exits'],
    ['playback.played', { targetLabel: 'Fire exits' }, 'Played', 'neutral', 'playback', 'Anita played Fire exits'],
  ] as const)('%s', (action, overrides, label, tone, category, summary) => {
    expect(presentAudit(entry({ action, ...overrides }))).toEqual({ label, tone, category, summary });
  });

  it.each([
    ['not_mp4', 'the file is not a valid MP4'],
    ['bad_image', 'the cover image is not valid'],
    ['expired', 'it was not finished within 24 hours'],
  ])('explains the failure reason %s in plain words', (reason, words) => {
    const result = presentAudit(entry({ action: 'file.upload_failed', targetLabel: 'T', actorName: null, actorLabel: null, metadata: { reason } }));
    expect(result.summary).toBe(`The upload of T failed (${words})`);
  });

  it('omits the reason when it is unknown, including inherited object names', () => {
    for (const reason of ['something_new', 'constructor', undefined]) {
      expect(presentAudit(entry({ action: 'file.upload_failed', targetLabel: 'T', metadata: { reason } })).summary).toBe('The upload of T failed');
    }
  });

  it('files the new actions under the right categories', () => {
    const media = AUDIT_ACTIONS.filter((action) => /^(content\.(folder|video)|file\.upload|playback\.)/.test(action));
    expect(media).toHaveLength(12);
    expect(media.filter((action) => categoryOf(action) === 'content')).toHaveLength(7);
    expect(media.filter((action) => categoryOf(action) === 'files')).toHaveLength(4);
    expect(media.filter((action) => categoryOf(action) === 'playback')).toEqual(['playback.played']);
  });
});
