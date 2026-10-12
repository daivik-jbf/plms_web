import { MAX_AUDIO_BYTES, MAX_PDF_BYTES, MAX_VIDEO_BYTES, partCountFor } from '../storage/storage.constants';
import {
  ATTACHMENT_TYPE_MESSAGE,
  attachmentFieldErrors,
  attachmentKindFor,
  categoryFromSlug,
  kindOf,
  MEDIA_CATEGORIES,
  MEDIA_KINDS,
  uploadFieldErrors,
} from './media-kinds';

describe('media kinds and categories', () => {
  it('maps each route slug to its category and nothing else to anything', () => {
    expect(['videos', 'movies', 'podcasts', 'songs'].map(categoryFromSlug)).toEqual(['video', 'movie', 'podcast', 'song']);
    for (const slug of ['video', 'Videos', 'SONGS', 'music', '', 'constructor', '__proto__', 'toString', 'songs/']) {
      expect(categoryFromSlug(slug)).toBeNull();
    }
  });

  it('gives videos and movies the video kind, podcasts and songs the audio kind', () => {
    expect(kindOf('video')).toBe(MEDIA_KINDS.video);
    expect(kindOf('movie')).toBe(MEDIA_KINDS.video);
    expect(kindOf('podcast')).toBe(MEDIA_KINDS.audio);
    expect(kindOf('song')).toBe(MEDIA_KINDS.audio);
    expect(MEDIA_KINDS.video).toMatchObject({
      purpose: 'video',
      keyPrefix: 'videos',
      contentTypes: ['video/mp4'],
      maxBytes: 2_147_483_648,
      failureReason: 'not_mp4',
    });
    expect(MEDIA_KINDS.audio).toMatchObject({
      purpose: 'audio',
      keyPrefix: 'audio',
      contentTypes: ['audio/mpeg', 'audio/mp4'],
      maxBytes: 524_288_000,
      failureReason: 'not_audio',
    });
  });

  it('has a PDF kind and an image kind for files attached to topics, with random-key prefixes of their own', () => {
    expect(MEDIA_KINDS.pdf).toMatchObject({
      purpose: 'pdf',
      keyPrefix: 'documents',
      contentTypes: ['application/pdf'],
      maxBytes: 52_428_800,
      failureReason: 'not_pdf',
    });
    expect(MEDIA_KINDS.image).toMatchObject({
      purpose: 'image',
      keyPrefix: 'images',
      contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxBytes: 10_485_760,
      failureReason: 'not_image',
    });
    expect(MAX_PDF_BYTES).toBe(50 * 1024 * 1024);
  });

  it('checks the first bytes of a PDF and of each image type', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1]);
    expect(MEDIA_KINDS.pdf.matches(pdf, 'application/pdf')).toBe(true);
    expect(MEDIA_KINDS.pdf.matches(new Uint8Array([0xff, 0xd8, 0xff]), 'application/pdf')).toBe(false);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(MEDIA_KINDS.image.matches(png, 'image/png')).toBe(true);
    expect(MEDIA_KINDS.image.matches(png, 'image/jpeg')).toBe(false);
    expect(MEDIA_KINDS.image.matches(pdf, 'image/webp')).toBe(false);
  });

  it('keeps the piece arithmetic: 500 MiB is 32 pieces, 2 GiB is 128, 50 MiB is 4, 10 MiB is 1', () => {
    expect(partCountFor(MAX_AUDIO_BYTES)).toBe(32);
    expect(partCountFor(MAX_VIDEO_BYTES)).toBe(128);
    expect(partCountFor(MAX_PDF_BYTES)).toBe(4);
    expect(partCountFor(MEDIA_KINDS.image.maxBytes)).toBe(1);
  });

  it.each([
    ['song', 'audio/mpeg', 524_288_000],
    ['podcast', 'audio/mp4', 524_288_000],
    ['movie', 'video/mp4', 2_147_483_648],
    ['video', 'video/mp4', 1],
  ] as const)('accepts a %s declared as %s of %i bytes', (category, type, size) => {
    expect(uploadFieldErrors(category, type, size)).toBeNull();
  });

  it('refuses one byte over each limit with a message that names the formats', () => {
    expect(uploadFieldErrors('song', 'audio/mpeg', 524_288_001)).toEqual({ sizeBytes: ['Audio files can be at most 500 MB (MP3 or M4A).'] });
    expect(uploadFieldErrors('podcast', 'audio/mp4', 524_288_001)).toEqual({ sizeBytes: ['Audio files can be at most 500 MB (MP3 or M4A).'] });
    expect(uploadFieldErrors('movie', 'video/mp4', 2_147_483_649)).toEqual({ sizeBytes: ['Videos can be at most 2 GB (MP4).'] });
  });

  it('refuses a type of the other kind and the aliases the server does not accept', () => {
    expect(uploadFieldErrors('song', 'video/mp4', 10)).toEqual({ contentType: ['Only MP3 or M4A audio files can be uploaded here.'] });
    expect(uploadFieldErrors('video', 'audio/mpeg', 10)?.contentType?.[0]).toMatch(/MP4.*HandBrake/);
    expect(uploadFieldErrors('movie', 'audio/mp4', 10)?.contentType?.[0]).toMatch(/MP4.*HandBrake/);
    for (const type of ['audio/x-m4a', 'audio/aac', 'audio/mp3', 'audio/wav', 'application/pdf', 'image/png']) {
      expect(uploadFieldErrors('podcast', type, 10)).toHaveProperty('contentType');
    }
    expect(uploadFieldErrors('video', 'application/pdf', 10)).toHaveProperty('contentType');
  });

  it('reports a wrong type and a wrong size together', () => {
    expect(Object.keys(uploadFieldErrors('song', 'video/mp4', 600 * 1024 ** 2) ?? {}).sort()).toEqual(['contentType', 'sizeBytes']);
  });

  it('has the words the folder labels and the audit log use', () => {
    expect(MEDIA_CATEGORIES.song).toEqual({ slug: 'songs', kind: 'audio', noun: 'song', nounPlural: 'songs', label: 'Song' });
    expect(MEDIA_CATEGORIES.video).toEqual({ slug: 'videos', kind: 'video', noun: 'video', nounPlural: 'videos', label: 'Video' });
  });
});

describe('the kind of a file attached to a topic', () => {
  it.each([
    ['video/mp4', 'video'],
    ['audio/mpeg', 'audio'],
    ['audio/mp4', 'audio'],
    ['application/pdf', 'pdf'],
    ['image/jpeg', 'image'],
    ['image/png', 'image'],
    ['image/webp', 'image'],
  ])('follows the declared type %s to the %s kind', (type, kind) => {
    expect(attachmentKindFor(type)).toBe(kind);
  });

  it.each(['image/gif', 'image/svg+xml', 'application/zip', 'application/x-pdf', 'APPLICATION/PDF', 'video/quicktime', 'audio/x-m4a', 'audio/aac', 'text/html', '', 'constructor', '__proto__'])(
    'knows no kind for the declared type %j',
    (type) => {
      expect(attachmentKindFor(type)).toBeNull();
    },
  );

  it.each([
    ['video/mp4', 2_147_483_648],
    ['audio/mpeg', 524_288_000],
    ['audio/mp4', 524_288_000],
    ['application/pdf', 52_428_800],
    ['image/jpeg', 10_485_760],
    ['image/png', 10_485_760],
    ['image/webp', 10_485_760],
    ['application/pdf', 1],
  ])('accepts %s of exactly %i bytes', (type, size) => {
    expect(attachmentFieldErrors(type, size)).toBeNull();
  });

  it.each([
    ['video/mp4', 2_147_483_649, 'Videos can be at most 2 GB (MP4).'],
    ['audio/mpeg', 524_288_001, 'Audio files can be at most 500 MB (MP3 or M4A).'],
    ['audio/mp4', 524_288_001, 'Audio files can be at most 500 MB (MP3 or M4A).'],
    ['application/pdf', 52_428_801, 'PDF files can be at most 50 MB.'],
    ['image/jpeg', 10_485_761, 'Images can be at most 10 MB (JPEG, PNG or WebP).'],
    ['image/png', 10_485_761, 'Images can be at most 10 MB (JPEG, PNG or WebP).'],
    ['image/webp', 10_485_761, 'Images can be at most 10 MB (JPEG, PNG or WebP).'],
  ])('refuses %s one byte over its limit', (type, size, message) => {
    expect(attachmentFieldErrors(type, size)).toEqual({ sizeBytes: [message] });
  });

  it('names every allowed format when the type is unknown, whatever the size', () => {
    expect(ATTACHMENT_TYPE_MESSAGE).toBe('Attachments can be MP4 videos, MP3 or M4A audio files, PDF files, or JPEG, PNG or WebP images.');
    expect(attachmentFieldErrors('image/gif', 10)).toEqual({ contentType: [ATTACHMENT_TYPE_MESSAGE] });
    expect(attachmentFieldErrors('application/zip', 5 * 1024 ** 4)).toEqual({ contentType: [ATTACHMENT_TYPE_MESSAGE] });
  });
});
