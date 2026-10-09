import { audioMatches, hasMp3Signature, hasMp4Signature, imageMatches, sanitizeFileName } from './file-checks';

const mp4 = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32];

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
  ])('%j becomes %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('cuts to 255 characters', () => {
    expect(sanitizeFileName('a'.repeat(400))).toHaveLength(255);
  });
});

describe('hasMp4Signature', () => {
  it('accepts ftyp at byte 4', () => expect(hasMp4Signature(new Uint8Array(mp4))).toBe(true));
  it('refuses other bytes, short input and a shifted marker', () => {
    expect(hasMp4Signature(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBe(false);
    expect(hasMp4Signature(new Uint8Array([0, 0, 0, 0x66, 0x74, 0x79, 0x70]))).toBe(false);
    expect(hasMp4Signature(new Uint8Array())).toBe(false);
    expect(hasMp4Signature(new Uint8Array([0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });
});

describe('imageMatches', () => {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
  const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
  const webp = [0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x45, 0x42, 0x50];

  it('accepts each format only under its own type', () => {
    expect(imageMatches(new Uint8Array(png), 'image/png')).toBe(true);
    expect(imageMatches(new Uint8Array(jpeg), 'image/jpeg')).toBe(true);
    expect(imageMatches(new Uint8Array(webp), 'image/webp')).toBe(true);
    expect(imageMatches(new Uint8Array(png), 'image/jpeg')).toBe(false);
    expect(imageMatches(new Uint8Array(jpeg), 'image/webp')).toBe(false);
    expect(imageMatches(new Uint8Array(webp), 'image/png')).toBe(false);
  });

  it('refuses a RIFF file that is not WebP, short input, and unknown types', () => {
    expect(imageMatches(new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x41, 0x56, 0x49, 0x20]), 'image/webp')).toBe(false);
    expect(imageMatches(new Uint8Array([0xff, 0xd8]), 'image/jpeg')).toBe(false);
    expect(imageMatches(new Uint8Array(png), 'image/gif')).toBe(false);
    expect(imageMatches(new Uint8Array(mp4), 'image/png')).toBe(false);
  });
});

describe('hasMp3Signature', () => {
  it.each([
    ['an ID3 tag', [0x49, 0x44, 0x33, 4, 0]],
    ['an MPEG-1 Layer III frame (FF FB)', [0xff, 0xfb, 0x90, 0x64]],
    ['an MPEG-2 frame (FF F3)', [0xff, 0xf3, 0x90, 0x64]],
    ['an MPEG-2.5 frame (FF E3)', [0xff, 0xe3, 0x90, 0x64]],
    ['the smallest frame sync (FF E0)', [0xff, 0xe0]],
  ])('accepts %s', (_name, bytes) => {
    expect(hasMp3Signature(new Uint8Array(bytes))).toBe(true);
  });

  it.each([
    ['a JPEG (FF D8)', [0xff, 0xd8, 0xff, 0xe0]],
    ['FF with only two sync bits (FF C0)', [0xff, 0xc0]],
    ['a lone FF', [0xff]],
    ['nothing', []],
    ['an unfinished ID3 tag', [0x49, 0x44]],
    ['a lower-case id3', [0x69, 0x64, 0x33]],
    ['a frame sync one byte late', [0x00, 0xff, 0xfb]],
    ['a WAV file', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]],
    ['an MP4', mp4],
  ])('refuses %s', (_name, bytes) => {
    expect(hasMp3Signature(new Uint8Array(bytes))).toBe(false);
  });
});

describe('audioMatches', () => {
  const mp3 = [0xff, 0xfb, 0x90, 0x64];
  const m4a = [0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20];

  it('checks MP3 and M4A each under its own declared type only', () => {
    expect(audioMatches(new Uint8Array(mp3), 'audio/mpeg')).toBe(true);
    expect(audioMatches(new Uint8Array(m4a), 'audio/mp4')).toBe(true);
    expect(audioMatches(new Uint8Array(m4a), 'audio/mpeg')).toBe(false);
    expect(audioMatches(new Uint8Array(mp3), 'audio/mp4')).toBe(false);
  });

  it('refuses every other declared type, including the aliases some systems report', () => {
    for (const type of ['audio/x-m4a', 'audio/aac', 'audio/mp3', 'audio/wav', 'video/mp4', '']) {
      expect(audioMatches(new Uint8Array(m4a), type)).toBe(false);
      expect(audioMatches(new Uint8Array(mp3), type)).toBe(false);
    }
  });
});
