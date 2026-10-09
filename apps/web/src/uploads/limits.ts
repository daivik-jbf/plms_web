export const MAX_VIDEO_BYTES = 2 * 1024 ** 3;
export const MAX_COVER_BYTES = 10 * 1024 ** 2;
export const MP4_HELP = 'Only MP4 videos can be uploaded. Convert the file to MP4 first (for example with HandBrake).';

const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Returns a plain-words problem, or null when the file is fine. The server checks everything again.
export function checkVideoFile(file: File): string | null {
  const isMp4 = file.type === 'video/mp4' || (file.type === '' && /\.mp4$/i.test(file.name));
  if (!isMp4) return MP4_HELP;
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_VIDEO_BYTES) return 'Videos can be at most 2 GB. Choose a smaller file or compress it first.';
  return null;
}

export function checkCoverFile(file: File): string | null {
  if (!COVER_TYPES.includes(file.type)) return 'Choose a JPEG, PNG or WebP image.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_COVER_BYTES) return 'Covers can be at most 10 MB.';
  return null;
}
