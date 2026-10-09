import { describe, expect, it } from 'vitest';
import { sanitizeFileName } from './sanitize-file-name';

// The same vectors as apps/api/src/media/file-checks.spec.ts: the two copies must stay identical.
describe('sanitizeFileName', () => {
  it.each([
    ['Fire exits.mp4', 'Fire exits.mp4'],
    ['../../etc/passwd', 'etc passwd'],
    ['C:\\videos\\a.mp4', 'C: videos a.mp4'],
    ['  spaced   out.mp4 ', 'spaced out.mp4'],
    ['bad\u0000name\u0007.mp4', 'bad name .mp4'],
    ['...hidden.mp4', 'hidden.mp4'],
    ['///', 'video.mp4'],
    ['', 'video.mp4'],
    ['<b>x</b>.mp4', '<b>x< b>.mp4'],
    ['.hidden.mp4', 'hidden.mp4'],
    ['My  talk.mp4', 'My talk.mp4'],
    ['Screen Recording 2026-10-08 at 10.00.00\u202fAM.mp4', 'Screen Recording 2026-10-08 at 10.00.00 AM.mp4'],
  ])('%j becomes %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('cuts to 255 characters', () => {
    expect(sanitizeFileName('a'.repeat(400))).toHaveLength(255);
    expect(sanitizeFileName(`${'a'.repeat(300)}.mp4`)).toBe('a'.repeat(255));
  });
});
