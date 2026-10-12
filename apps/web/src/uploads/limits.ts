export type MediaKind = 'video' | 'audio';
// What can be attached to a topic: the library's two kinds, and PDFs and images.
export type AttachmentKind = MediaKind | 'pdf' | 'image';

export const MAX_VIDEO_BYTES = 2 * 1024 ** 3;
export const MAX_AUDIO_BYTES = 500 * 1024 ** 2;
export const MAX_COVER_BYTES = 10 * 1024 ** 2;
export const MAX_PDF_BYTES = 50 * 1024 ** 2;
export const MP4_HELP = 'Only MP4 videos can be uploaded. Convert the file to MP4 first (for example with HandBrake).';
export const AUDIO_HELP = 'Only MP3 or M4A audio files can be uploaded here.';
export const ATTACHMENT_HELP = 'Attachments can be MP4 videos, MP3 or M4A audio files, PDF files, or JPEG, PNG or WebP images.';

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

const IMAGE_BY_EXTENSION: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const PDF_RULE: KindRule = {
  accept: 'application/pdf,.pdf',
  formats: 'PDF, up to 50 MB',
  maxBytes: MAX_PDF_BYTES,
  wrongType: 'Only PDF files can be attached as documents.',
  tooLarge: 'PDF files can be at most 50 MB. Choose a smaller file.',
  declaredType: (file) => (file.type === 'application/pdf' || (file.type === '' && extensionOf(file.name) === 'pdf') ? 'application/pdf' : null),
};

const IMAGE_RULE: KindRule = {
  accept: 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp',
  formats: 'JPEG, PNG or WebP, up to 10 MB',
  maxBytes: MAX_COVER_BYTES,
  wrongType: 'Only JPEG, PNG or WebP images can be attached.',
  tooLarge: 'Images can be at most 10 MB. Choose a smaller file.',
  // A file the system did not type is recognised by its extension, as for videos.
  declaredType: (file) => (COVER_TYPES.includes(file.type) ? file.type : file.type === '' ? (IMAGE_BY_EXTENSION[extensionOf(file.name)] ?? null) : null),
};

// The same four kinds as the server's (apps/api/src/media/media-kinds.ts), in the order a file is recognised.
export const ATTACHMENT_KINDS: Record<AttachmentKind, KindRule> = { video: MEDIA_KINDS.video, audio: MEDIA_KINDS.audio, pdf: PDF_RULE, image: IMAGE_RULE };
const ATTACHMENT_KIND_LIST = Object.keys(ATTACHMENT_KINDS) as AttachmentKind[];
export const ATTACHMENT_ACCEPT = ATTACHMENT_KIND_LIST.map((kind) => ATTACHMENT_KINDS[kind].accept).join(',');

export type FileCheck = { ok: true; contentType: string } | { ok: false; problem: string };
export type AttachmentCheck = { ok: true; kind: AttachmentKind; contentType: string } | { ok: false; problem: string };

// The type to declare for the file, or a plain-words problem.
function checkRule(rule: KindRule, file: File): FileCheck {
  const contentType = rule.declaredType(file);
  if (!contentType) return { ok: false, problem: rule.wrongType };
  if (file.size === 0) return { ok: false, problem: 'That file is empty.' };
  if (file.size > rule.maxBytes) return { ok: false, problem: rule.tooLarge };
  return { ok: true, contentType };
}

export const checkMediaFile = (kind: MediaKind, file: File): FileCheck => checkRule(MEDIA_KINDS[kind], file);

// An attachment has no folder to say what it is: the first kind that recognises the file decides, and its limits apply.
export function checkAttachmentFile(file: File): AttachmentCheck {
  const kind = ATTACHMENT_KIND_LIST.find((candidate) => ATTACHMENT_KINDS[candidate].declaredType(file) !== null);
  if (!kind) return { ok: false, problem: ATTACHMENT_HELP };
  const check = checkRule(ATTACHMENT_KINDS[kind], file);
  return check.ok ? { ok: true, kind, contentType: check.contentType } : check;
}

export function checkCoverFile(file: File): string | null {
  if (!COVER_TYPES.includes(file.type)) return 'Choose a JPEG, PNG or WebP image.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_COVER_BYTES) return 'Covers can be at most 10 MB.';
  return null;
}
