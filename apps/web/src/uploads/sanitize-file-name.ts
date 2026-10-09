// Exact copy of sanitizeFileName in apps/api/src/media/file-checks.ts. The server stores the tidied name,
// so resuming compares the tidied name of the chosen file. The two copies must stay identical.
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
