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
    ['content.video.added', { targetLabel: 'Fire exits' }, 'Item added', 'change', 'content', 'Anita added the video Fire exits'],
    ['content.video.edited', { targetLabel: 'Fire exits' }, 'Item edited', 'change', 'content', 'Anita edited the video Fire exits'],
    ['content.video.reordered', { targetLabel: 'Safety' }, 'Items reordered', 'neutral', 'content', 'Anita changed the order of the videos in Safety'],
    ['content.video.cover_set', { targetLabel: 'Fire exits' }, 'Cover set', 'change', 'content', 'Anita set the cover image of the video Fire exits'],
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
    ['song', 'song', 'songs'],
    ['podcast', 'podcast', 'podcasts'],
    ['movie', 'movie', 'movies'],
    ['video', 'video', 'videos'],
  ])('uses the word for a %s from metadata.category', (category, noun, plural) => {
    const say = (action: string, targetLabel: string) => presentAudit(entry({ action, targetLabel, metadata: { category } })).summary;
    expect(say('content.video.added', 'T')).toBe(`Anita added the ${noun} T`);
    expect(say('content.video.edited', 'T')).toBe(`Anita edited the ${noun} T`);
    expect(say('content.video.cover_set', 'T')).toBe(`Anita set the cover image of the ${noun} T`);
    expect(say('content.video.reordered', 'Road trip')).toBe(`Anita changed the order of the ${plural} in Road trip`);
    expect(say('content.folder.reordered', 'Song folders')).toBe(`Anita changed the order of the ${noun} folders`);
  });

  it('falls back to "video" for entries written before milestone 4 and for unknown or inherited values', () => {
    for (const metadata of [null, {}, { category: 'karaoke' }, { category: 'constructor' }, { category: '__proto__' }, { category: 5 }]) {
      expect(presentAudit(entry({ action: 'content.video.added', targetLabel: 'T', metadata })).summary).toBe('Anita added the video T');
      expect(presentAudit(entry({ action: 'content.video.reordered', targetLabel: 'F', metadata })).summary).toBe('Anita changed the order of the videos in F');
    }
  });

  it('keeps the upload and playback sentences the same for audio', () => {
    expect(presentAudit(entry({ action: 'playback.played', targetLabel: 'Morning song', metadata: { category: 'song' } })).summary).toBe('Anita played Morning song');
  });

  it.each([
    ['not_mp4', 'the file is not a valid MP4'],
    ['not_audio', 'the file is not a valid MP3 or M4A'],
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

  it('files the media actions under the right categories', () => {
    const media = AUDIT_ACTIONS.filter((action) => /^(content\.(folder|video)|file\.upload|playback\.)/.test(action));
    expect(media).toHaveLength(12);
    expect(media.filter((action) => categoryOf(action) === 'content')).toHaveLength(7);
    expect(media.filter((action) => categoryOf(action) === 'files')).toHaveLength(4);
    expect(media.filter((action) => categoryOf(action) === 'playback')).toEqual(['playback.played']);
  });
});
