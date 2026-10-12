import type { mediaCategory } from '../db/schema';
import {
  AUDIO_CONTENT_TYPES,
  COVER_CONTENT_TYPES,
  MAX_AUDIO_BYTES,
  MAX_COVER_BYTES,
  MAX_PDF_BYTES,
  MAX_VIDEO_BYTES,
  PDF_CONTENT_TYPE,
  VIDEO_CONTENT_TYPE,
} from '../storage/storage.constants';
import { audioMatches, hasMp4Signature, hasPdfSignature, imageMatches } from './file-checks';

export type MediaCategory = (typeof mediaCategory.enumValues)[number];
// The kinds of file the portal stores. A library category holds videos or audio; a file attached to a topic can also be a
// PDF or an image.
export type MediaKind = 'video' | 'audio' | 'pdf' | 'image';
export type LibraryKind = 'video' | 'audio';

// What may be uploaded as a file of this kind, and how a finished upload is checked.
export interface KindRule {
  // The files.purpose of the main file, and the prefix of its random storage key.
  purpose: MediaKind;
  keyPrefix: 'videos' | 'audio' | 'documents' | 'images';
  contentTypes: readonly string[];
  maxBytes: number;
  sizeMessage: string;
  // Recorded in file.upload_failed when the first bytes do not match the declared type.
  failureReason: 'not_mp4' | 'not_audio' | 'not_pdf' | 'not_image';
  matches: (bytes: Uint8Array, contentType: string) => boolean;
}

// The web app keeps a matching table for its file picker (apps/web/src/uploads/limits.ts); this one is the rule.
export const MEDIA_KINDS: Record<MediaKind, KindRule> = {
  video: {
    purpose: 'video',
    keyPrefix: 'videos',
    contentTypes: [VIDEO_CONTENT_TYPE],
    maxBytes: MAX_VIDEO_BYTES,
    sizeMessage: 'Videos can be at most 2 GB (MP4).',
    failureReason: 'not_mp4',
    matches: (bytes) => hasMp4Signature(bytes),
  },
  audio: {
    purpose: 'audio',
    keyPrefix: 'audio',
    contentTypes: AUDIO_CONTENT_TYPES,
    maxBytes: MAX_AUDIO_BYTES,
    sizeMessage: 'Audio files can be at most 500 MB (MP3 or M4A).',
    failureReason: 'not_audio',
    matches: audioMatches,
  },
  pdf: {
    purpose: 'pdf',
    keyPrefix: 'documents',
    contentTypes: [PDF_CONTENT_TYPE],
    maxBytes: MAX_PDF_BYTES,
    sizeMessage: 'PDF files can be at most 50 MB.',
    failureReason: 'not_pdf',
    matches: (bytes) => hasPdfSignature(bytes),
  },
  // The same formats and limit as a cover image.
  image: {
    purpose: 'image',
    keyPrefix: 'images',
    contentTypes: COVER_CONTENT_TYPES,
    maxBytes: MAX_COVER_BYTES,
    sizeMessage: 'Images can be at most 10 MB (JPEG, PNG or WebP).',
    failureReason: 'not_image',
    matches: imageMatches,
  },
};

// What a library upload says when the declared type is not one the folder's kind accepts.
const LIBRARY_TYPE_MESSAGES: Record<LibraryKind, string> = {
  video: 'Only MP4 videos can be uploaded. Convert the file to MP4 first (for example with HandBrake).',
  audio: 'Only MP3 or M4A audio files can be uploaded here.',
};

export interface CategoryRule {
  // The route slug: /api/media/<slug>/folders.
  slug: 'videos' | 'movies' | 'podcasts' | 'songs';
  kind: LibraryKind;
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
const KIND_LIST = Object.keys(MEDIA_KINDS) as MediaKind[];

export const kindOf = (category: MediaCategory): KindRule => MEDIA_KINDS[MEDIA_CATEGORIES[category].kind];

// Own entries only: a slug such as "constructor" or "__proto__" is simply unknown.
export function categoryFromSlug(slug: string): MediaCategory | null {
  return CATEGORY_LIST.find((category) => MEDIA_CATEGORIES[category].slug === slug) ?? null;
}

// The problems with a declared upload for this category, by body field, in plain words; null when it is acceptable.
export function uploadFieldErrors(category: MediaCategory, contentType: string, sizeBytes: number): Record<string, string[]> | null {
  const kind = kindOf(category);
  const errors: Record<string, string[]> = {};
  if (!kind.contentTypes.includes(contentType)) errors.contentType = [LIBRARY_TYPE_MESSAGES[MEDIA_CATEGORIES[category].kind]];
  if (sizeBytes > kind.maxBytes) errors.sizeBytes = [kind.sizeMessage];
  return Object.keys(errors).length > 0 ? errors : null;
}

export const ATTACHMENT_TYPE_MESSAGE = 'Attachments can be MP4 videos, MP3 or M4A audio files, PDF files, or JPEG, PNG or WebP images.';

// An attachment has no folder to decide its kind: the declared type does. Each type belongs to exactly one kind.
export function attachmentKindFor(contentType: string): MediaKind | null {
  return KIND_LIST.find((kind) => MEDIA_KINDS[kind].contentTypes.includes(contentType)) ?? null;
}

// The problems with a declared attachment upload, by body field, in plain words; null when it is acceptable. An unknown
// type is reported alone: without a kind there is no limit to compare the size with.
export function attachmentFieldErrors(contentType: string, sizeBytes: number): Record<string, string[]> | null {
  const kind = attachmentKindFor(contentType);
  if (!kind) return { contentType: [ATTACHMENT_TYPE_MESSAGE] };
  return sizeBytes > MEDIA_KINDS[kind].maxBytes ? { sizeBytes: [MEDIA_KINDS[kind].sizeMessage] } : null;
}
