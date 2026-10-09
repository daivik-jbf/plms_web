import type { mediaCategory } from '../db/schema';
import { AUDIO_CONTENT_TYPES, MAX_AUDIO_BYTES, MAX_VIDEO_BYTES, VIDEO_CONTENT_TYPE } from '../storage/storage.constants';
import { audioMatches, hasMp4Signature } from './file-checks';

export type MediaCategory = (typeof mediaCategory.enumValues)[number];
export type MediaKind = 'video' | 'audio';

// What may be uploaded to a category of this kind, and how a finished upload is checked.
export interface KindRule {
  // The files.purpose of the main file, and the prefix of its random storage key.
  purpose: MediaKind;
  keyPrefix: 'videos' | 'audio';
  contentTypes: readonly string[];
  maxBytes: number;
  typeMessage: string;
  sizeMessage: string;
  // Recorded in file.upload_failed when the first bytes do not match the declared type.
  failureReason: 'not_mp4' | 'not_audio';
  matches: (bytes: Uint8Array, contentType: string) => boolean;
}

// The web app keeps a matching table for its file picker (apps/web/src/uploads/limits.ts); this one is the rule.
export const MEDIA_KINDS: Record<MediaKind, KindRule> = {
  video: {
    purpose: 'video',
    keyPrefix: 'videos',
    contentTypes: [VIDEO_CONTENT_TYPE],
    maxBytes: MAX_VIDEO_BYTES,
    typeMessage: 'Only MP4 videos can be uploaded. Convert the file to MP4 first (for example with HandBrake).',
    sizeMessage: 'Videos can be at most 2 GB (MP4).',
    failureReason: 'not_mp4',
    matches: (bytes) => hasMp4Signature(bytes),
  },
  audio: {
    purpose: 'audio',
    keyPrefix: 'audio',
    contentTypes: AUDIO_CONTENT_TYPES,
    maxBytes: MAX_AUDIO_BYTES,
    typeMessage: 'Only MP3 or M4A audio files can be uploaded here.',
    sizeMessage: 'Audio files can be at most 500 MB (MP3 or M4A).',
    failureReason: 'not_audio',
    matches: audioMatches,
  },
};

export interface CategoryRule {
  // The route slug: /api/media/<slug>/folders.
  slug: 'videos' | 'movies' | 'podcasts' | 'songs';
  kind: MediaKind;
  // Words for sentences ("the song", "the songs") and labels ("Song folders").
  noun: string;
  nounPlural: string;
  label: string;
}

export const MEDIA_CATEGORIES: Record<MediaCategory, CategoryRule> = {
  video: { slug: 'videos', kind: 'video', noun: 'video', nounPlural: 'videos', label: 'Video' },
  movie: { slug: 'movies', kind: 'video', noun: 'movie', nounPlural: 'movies', label: 'Movie' },
  podcast: { slug: 'podcasts', kind: 'audio', noun: 'podcast', nounPlural: 'podcasts', label: 'Podcast' },
  song: { slug: 'songs', kind: 'audio', noun: 'song', nounPlural: 'songs', label: 'Song' },
};

const CATEGORY_LIST = Object.keys(MEDIA_CATEGORIES) as MediaCategory[];

export const kindOf = (category: MediaCategory): KindRule => MEDIA_KINDS[MEDIA_CATEGORIES[category].kind];

// Own entries only: a slug such as "constructor" or "__proto__" is simply unknown.
export function categoryFromSlug(slug: string): MediaCategory | null {
  return CATEGORY_LIST.find((category) => MEDIA_CATEGORIES[category].slug === slug) ?? null;
}

// The problems with a declared upload for this category, by body field, in plain words; null when it is acceptable.
export function uploadFieldErrors(category: MediaCategory, contentType: string, sizeBytes: number): Record<string, string[]> | null {
  const kind = kindOf(category);
  const errors: Record<string, string[]> = {};
  if (!kind.contentTypes.includes(contentType)) errors.contentType = [kind.typeMessage];
  if (sizeBytes > kind.maxBytes) errors.sizeBytes = [kind.sizeMessage];
  return Object.keys(errors).length > 0 ? errors : null;
}
