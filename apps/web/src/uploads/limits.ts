export type MediaKind = 'video' | 'audio';

export const MAX_VIDEO_BYTES = 2 * 1024 ** 3;
export const MAX_AUDIO_BYTES = 500 * 1024 ** 2;
export const MAX_COVER_BYTES = 10 * 1024 ** 2;
export const MP4_HELP = 'Only MP4 videos can be uploaded. Convert the file to MP4 first (for example with HandBrake).';
export const AUDIO_HELP = 'Only MP3 or M4A audio files can be uploaded here.';

const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const extensionOf = (name: string): string => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

interface KindRule {
  // For the file picker: which files to offer and how to describe them.
  accept: string;
  formats: string;
  maxBytes: number;
  wrongType: string;
  tooLarge: string;
  // The type to tell the server, or null when the file is not of this kind.
  declaredType: (file: File) => string | null;
}

// The browser's copy of the server's rules (apps/api/src/media/media-kinds.ts), for quick answers before anything is
// sent. The server checks everything again.
export const MEDIA_KINDS: Record<MediaKind, KindRule> = {
  video: {
    accept: 'video/mp4,.mp4',
    formats: 'MP4, up to 2 GB',
    maxBytes: MAX_VIDEO_BYTES,
    wrongType: MP4_HELP,
    tooLarge: 'Videos can be at most 2 GB. Choose a smaller file or compress it first.',
    declaredType: (file) => (file.type === 'video/mp4' || (file.type === '' && extensionOf(file.name) === 'mp4') ? 'video/mp4' : null),
  },
  audio: {
    accept: 'audio/mpeg,audio/mp4,.mp3,.m4a',
    formats: 'MP3 or M4A, up to 500 MB',
    maxBytes: MAX_AUDIO_BYTES,
    wrongType: AUDIO_HELP,
    tooLarge: 'Audio files can be at most 500 MB. Choose a smaller file.',
    // Systems report M4A files under several names (audio/x-m4a, audio/aac or none) and MP3 files sometimes as
    // audio/mp3; the server accepts only audio/mp4 and audio/mpeg. A raw .aac file is not an M4A and is refused.
    declaredType: (file) => {
      const extension = extensionOf(file.name);
      if (file.type === 'audio/mpeg' || (extension === 'mp3' && ['', 'audio/mp3'].includes(file.type))) return 'audio/mpeg';
      if (file.type === 'audio/mp4' || (extension === 'm4a' && ['', 'audio/x-m4a', 'audio/aac', 'audio/m4a'].includes(file.type))) return 'audio/mp4';
      return null;
    },
  },
};

export type FileCheck = { ok: true; contentType: string } | { ok: false; problem: string };

// The type to declare for the file, or a plain-words problem.
export function checkMediaFile(kind: MediaKind, file: File): FileCheck {
  const rule = MEDIA_KINDS[kind];
  const contentType = rule.declaredType(file);
  if (!contentType) return { ok: false, problem: rule.wrongType };
  if (file.size === 0) return { ok: false, problem: 'That file is empty.' };
  if (file.size > rule.maxBytes) return { ok: false, problem: rule.tooLarge };
  return { ok: true, contentType };
}

export function checkCoverFile(file: File): string | null {
  if (!COVER_TYPES.includes(file.type)) return 'Choose a JPEG, PNG or WebP image.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_COVER_BYTES) return 'Covers can be at most 10 MB.';
  return null;
}
