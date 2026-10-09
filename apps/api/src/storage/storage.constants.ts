export const MAX_VIDEO_BYTES = 2 * 1024 ** 3;
export const PART_SIZE = 16 * 1024 ** 2;
// S3 and R2 require every piece except the last to be at least this large.
export const MIN_PART_SIZE = 5 * 1024 ** 2;
export const MAX_COVER_BYTES = 10 * 1024 ** 2;
export const VIDEO_CONTENT_TYPE = 'video/mp4';
export const MAX_AUDIO_BYTES = 500 * 1024 ** 2;
// MP3 and M4A. Raw AAC (ADTS) and other formats are not accepted.
export const AUDIO_CONTENT_TYPES = ['audio/mpeg', 'audio/mp4'] as const;
export const COVER_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const LINK_TTL_SECONDS = 3600;
export const MAX_PART_URLS_PER_REQUEST = 16;
export const PENDING_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const partCountFor = (sizeBytes: number): number => Math.ceil(sizeBytes / PART_SIZE);
