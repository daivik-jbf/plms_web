// Display-only: nothing derived from a file name is ever used as a storage path.
// The web app keeps an exact copy (apps/web/src/uploads/sanitize-file-name.ts) so it can recognise the stored
// name when resuming. The two copies must stay identical.
export function sanitizeFileName(input: string): string {
  const cleaned = input
    .replace(/[\p{Cc}\\/]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .slice(0, 255)
    .trim();
  return cleaned === '' ? 'video.mp4' : cleaned;
}

const startsWith = (bytes: Uint8Array, offset: number, expected: number[]): boolean =>
  bytes.length >= offset + expected.length && expected.every((value, index) => bytes[offset + index] === value);

const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

// An MP4 starts with a box whose type, at bytes 4 to 7, is "ftyp".
export const hasMp4Signature = (bytes: Uint8Array): boolean => startsWith(bytes, 4, ascii('ftyp'));

export function imageMatches(bytes: Uint8Array, contentType: string): boolean {
  switch (contentType) {
    case 'image/jpeg':
      return startsWith(bytes, 0, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WEBP'));
    default:
      return false;
  }
}
