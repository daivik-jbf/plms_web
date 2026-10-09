import { MAX_AUDIO_BYTES, MAX_VIDEO_BYTES, partCountFor } from '../storage/storage.constants';
import { categoryFromSlug, kindOf, MEDIA_CATEGORIES, MEDIA_KINDS, uploadFieldErrors } from './media-kinds';

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

  it('keeps the piece arithmetic: 500 MiB is 32 pieces and 2 GiB is 128', () => {
    expect(partCountFor(MAX_AUDIO_BYTES)).toBe(32);
    expect(partCountFor(MAX_VIDEO_BYTES)).toBe(128);
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
    for (const type of ['audio/x-m4a', 'audio/aac', 'audio/mp3', 'audio/wav']) {
      expect(uploadFieldErrors('podcast', type, 10)).toHaveProperty('contentType');
    }
  });

  it('reports a wrong type and a wrong size together', () => {
    expect(Object.keys(uploadFieldErrors('song', 'video/mp4', 600 * 1024 ** 2) ?? {}).sort()).toEqual(['contentType', 'sizeBytes']);
  });

  it('has the words the folder labels and the audit log use', () => {
    expect(MEDIA_CATEGORIES.song).toEqual({ slug: 'songs', kind: 'audio', noun: 'song', nounPlural: 'songs', label: 'Song' });
    expect(MEDIA_CATEGORIES.video).toEqual({ slug: 'videos', kind: 'video', noun: 'video', nounPlural: 'videos', label: 'Video' });
  });
});
