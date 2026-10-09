import { describe, expect, it } from 'vitest';
import { checkCoverFile, checkVideoFile, MAX_COVER_BYTES, MAX_VIDEO_BYTES, MP4_HELP } from './limits';

const file = (name: string, type: string, size: number): File => {
  const made = new File(['x'], name, { type });
  Object.defineProperty(made, 'size', { value: size });
  return made;
};

describe('checkVideoFile', () => {
  it('accepts an MP4 up to exactly 2 GB', () => {
    expect(checkVideoFile(file('a.mp4', 'video/mp4', 1))).toBeNull();
    expect(checkVideoFile(file('a.mp4', 'video/mp4', MAX_VIDEO_BYTES))).toBeNull();
  });

  it('accepts an .mp4 whose type the system did not report', () => {
    expect(checkVideoFile(file('Clip.MP4', '', 10))).toBeNull();
  });

  it('explains how to convert anything else', () => {
    for (const bad of [file('a.mov', 'video/quicktime', 10), file('a.webm', 'video/webm', 10), file('a.txt', '', 10), file('a.mp4.exe', '', 10)]) {
      expect(checkVideoFile(bad)).toBe(MP4_HELP);
    }
    expect(MP4_HELP).toMatch(/HandBrake/);
  });

  it('refuses an empty file and a file over 2 GB', () => {
    expect(checkVideoFile(file('a.mp4', 'video/mp4', 0))).toMatch(/empty/i);
    expect(checkVideoFile(file('a.mp4', 'video/mp4', MAX_VIDEO_BYTES + 1))).toMatch(/at most 2 GB/);
  });
});

describe('checkCoverFile', () => {
  it('accepts JPEG, PNG and WebP up to exactly 10 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(checkCoverFile(file('c', type, MAX_COVER_BYTES))).toBeNull();
    }
  });

  it('refuses other types, empty files and files over 10 MB', () => {
    expect(checkCoverFile(file('c.gif', 'image/gif', 10))).toMatch(/JPEG, PNG or WebP/);
    expect(checkCoverFile(file('c.png', 'image/png', 0))).toMatch(/empty/i);
    expect(checkCoverFile(file('c.png', 'image/png', MAX_COVER_BYTES + 1))).toMatch(/at most 10 MB/);
  });
});
