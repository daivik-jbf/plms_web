import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_HELP,
  ATTACHMENT_KINDS,
  AUDIO_HELP,
  checkAttachmentFile,
  checkCoverFile,
  checkMediaFile,
  MAX_AUDIO_BYTES,
  MAX_COVER_BYTES,
  MAX_PDF_BYTES,
  MAX_VIDEO_BYTES,
  MEDIA_KINDS,
  MP4_HELP,
} from './limits';

const file = (name: string, type: string, size: number): File => {
  const made = new File(['x'], name, { type });
  Object.defineProperty(made, 'size', { value: size });
  return made;
};

describe('checkMediaFile for videos and movies', () => {
  it('accepts an MP4 up to exactly 2 GB and declares it as video/mp4', () => {
    expect(checkMediaFile('video', file('a.mp4', 'video/mp4', 1))).toEqual({ ok: true, contentType: 'video/mp4' });
    expect(checkMediaFile('video', file('a.mp4', 'video/mp4', MAX_VIDEO_BYTES))).toEqual({ ok: true, contentType: 'video/mp4' });
  });

  it('accepts an .mp4 whose type the system did not report', () => {
    expect(checkMediaFile('video', file('Clip.MP4', '', 10))).toEqual({ ok: true, contentType: 'video/mp4' });
  });

  it('explains how to convert anything else, audio included', () => {
    for (const bad of [file('a.mov', 'video/quicktime', 10), file('a.webm', 'video/webm', 10), file('a.txt', '', 10), file('a.mp4.exe', '', 10), file('a.mp3', 'audio/mpeg', 10)]) {
      expect(checkMediaFile('video', bad)).toEqual({ ok: false, problem: MP4_HELP });
    }
    expect(MP4_HELP).toMatch(/HandBrake/);
  });

  it('refuses an empty file and a file over 2 GB', () => {
    expect(checkMediaFile('video', file('a.mp4', 'video/mp4', 0))).toEqual({ ok: false, problem: 'That file is empty.' });
    expect(checkMediaFile('video', file('a.mp4', 'video/mp4', MAX_VIDEO_BYTES + 1))).toEqual({
      ok: false,
      problem: 'Videos can be at most 2 GB. Choose a smaller file or compress it first.',
    });
  });
});

describe('checkMediaFile for podcasts and songs', () => {
  it.each([
    ['an MP3', 'song.mp3', 'audio/mpeg', 'audio/mpeg'],
    ['an MP3 the system did not type', 'song.MP3', '', 'audio/mpeg'],
    ['an MP3 reported as audio/mp3', 'song.mp3', 'audio/mp3', 'audio/mpeg'],
    ['an M4A', 'talk.m4a', 'audio/mp4', 'audio/mp4'],
    ['an M4A reported as audio/x-m4a', 'talk.m4a', 'audio/x-m4a', 'audio/mp4'],
    ['an M4A reported as audio/aac', 'talk.M4A', 'audio/aac', 'audio/mp4'],
    ['an M4A the system did not type', 'talk.m4a', '', 'audio/mp4'],
  ])('accepts %s and declares it as the server expects', (_name, name, type, declared) => {
    expect(checkMediaFile('audio', file(name, type, 10))).toEqual({ ok: true, contentType: declared });
  });

  it('accepts exactly 500 MB and refuses one byte more', () => {
    expect(checkMediaFile('audio', file('a.mp3', 'audio/mpeg', MAX_AUDIO_BYTES))).toEqual({ ok: true, contentType: 'audio/mpeg' });
    expect(checkMediaFile('audio', file('a.mp3', 'audio/mpeg', MAX_AUDIO_BYTES + 1))).toEqual({
      ok: false,
      problem: 'Audio files can be at most 500 MB. Choose a smaller file.',
    });
    expect(checkMediaFile('audio', file('a.mp3', 'audio/mpeg', 0))).toEqual({ ok: false, problem: 'That file is empty.' });
  });

  it('refuses raw AAC, WAV, FLAC, videos and unknown files with the audio message', () => {
    for (const bad of [
      file('raw.aac', 'audio/aac', 10),
      file('a.wav', 'audio/wav', 10),
      file('a.flac', 'audio/flac', 10),
      file('a.mp4', 'video/mp4', 10),
      file('a.m4a.exe', '', 10),
      file('noextension', '', 10),
    ]) {
      expect(checkMediaFile('audio', bad)).toEqual({ ok: false, problem: AUDIO_HELP });
    }
  });

  it('offers the right files in the picker', () => {
    expect(MEDIA_KINDS.video.accept).toBe('video/mp4,.mp4');
    expect(MEDIA_KINDS.audio.accept).toBe('audio/mpeg,audio/mp4,.mp3,.m4a');
    expect(MEDIA_KINDS.audio.formats).toBe('MP3 or M4A, up to 500 MB');
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

describe('checkAttachmentFile', () => {
  it('has the same sizes as the server for the four kinds', () => {
    expect(ATTACHMENT_KINDS.video.maxBytes).toBe(2_147_483_648);
    expect(ATTACHMENT_KINDS.audio.maxBytes).toBe(524_288_000);
    expect(ATTACHMENT_KINDS.pdf.maxBytes).toBe(52_428_800);
    expect(ATTACHMENT_KINDS.image.maxBytes).toBe(10_485_760);
    expect(MAX_PDF_BYTES).toBe(52_428_800);
    expect(ATTACHMENT_KINDS.video).toBe(MEDIA_KINDS.video);
    expect(ATTACHMENT_KINDS.audio).toBe(MEDIA_KINDS.audio);
  });

  it('offers every allowed type in the picker', () => {
    expect(ATTACHMENT_ACCEPT).toBe('video/mp4,.mp4,audio/mpeg,audio/mp4,.mp3,.m4a,application/pdf,.pdf,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp');
  });

  it.each([
    ['an MP4', 'a.mp4', 'video/mp4', 'video', 'video/mp4'],
    ['an MP4 the system did not type', 'a.MP4', '', 'video', 'video/mp4'],
    ['an MP3', 'a.mp3', 'audio/mpeg', 'audio', 'audio/mpeg'],
    ['an M4A reported as audio/x-m4a', 'a.m4a', 'audio/x-m4a', 'audio', 'audio/mp4'],
    ['a PDF', 'a.pdf', 'application/pdf', 'pdf', 'application/pdf'],
    ['a PDF the system did not type', 'Exit map.PDF', '', 'pdf', 'application/pdf'],
    ['a JPEG', 'a.jpg', 'image/jpeg', 'image', 'image/jpeg'],
    ['a PNG', 'a.png', 'image/png', 'image', 'image/png'],
    ['a WebP', 'a.webp', 'image/webp', 'image', 'image/webp'],
    ['a JPEG the system did not type', 'photo.jpeg', '', 'image', 'image/jpeg'],
    ['a PNG the system did not type', 'photo.PNG', '', 'image', 'image/png'],
  ])('accepts %s and declares it as the server expects', (_name, name, type, kind, declared) => {
    expect(checkAttachmentFile(file(name, type, 10))).toEqual({ ok: true, kind, contentType: declared });
  });

  it.each([
    ['an MP4', 'video/mp4', MAX_VIDEO_BYTES, 'a.mp4'],
    ['an MP3', 'audio/mpeg', MAX_AUDIO_BYTES, 'a.mp3'],
    ['a PDF', 'application/pdf', MAX_PDF_BYTES, 'a.pdf'],
    ['a PNG', 'image/png', MAX_COVER_BYTES, 'a.png'],
  ])('accepts %s of exactly its largest size and refuses one byte more', (_name, type, max, name) => {
    expect(checkAttachmentFile(file(name, type, max)).ok).toBe(true);
    expect(checkAttachmentFile(file(name, type, max + 1)).ok).toBe(false);
  });

  it('says what is too large in the words of its kind', () => {
    expect(checkAttachmentFile(file('a.pdf', 'application/pdf', MAX_PDF_BYTES + 1))).toEqual({ ok: false, problem: 'PDF files can be at most 50 MB. Choose a smaller file.' });
    expect(checkAttachmentFile(file('a.png', 'image/png', MAX_COVER_BYTES + 1))).toEqual({ ok: false, problem: 'Images can be at most 10 MB. Choose a smaller file.' });
    expect(checkAttachmentFile(file('a.mp4', 'video/mp4', MAX_VIDEO_BYTES + 1))).toMatchObject({ ok: false, problem: expect.stringMatching(/at most 2 GB/) });
    expect(checkAttachmentFile(file('a.mp3', 'audio/mpeg', MAX_AUDIO_BYTES + 1))).toMatchObject({ ok: false, problem: expect.stringMatching(/at most 500 MB/) });
  });

  it('refuses an empty file of any kind', () => {
    for (const [name, type] of [['a.pdf', 'application/pdf'], ['a.png', 'image/png'], ['a.mp4', 'video/mp4'], ['a.mp3', 'audio/mpeg']]) {
      expect(checkAttachmentFile(file(name!, type!, 0))).toEqual({ ok: false, problem: 'That file is empty.' });
    }
  });

  it('names every allowed format for anything else', () => {
    expect(ATTACHMENT_HELP).toBe('Attachments can be MP4 videos, MP3 or M4A audio files, PDF files, or JPEG, PNG or WebP images.');
    for (const bad of [
      file('a.gif', 'image/gif', 10),
      file('a.svg', 'image/svg+xml', 10),
      file('a.zip', 'application/zip', 10),
      file('a.mov', 'video/quicktime', 10),
      file('raw.aac', 'audio/aac', 10),
      file('a.pdf.exe', '', 10),
      file('noextension', '', 10),
      file('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10),
      file('a.pdf', 'application/x-pdf', 10),
    ]) {
      expect(checkAttachmentFile(bad)).toEqual({ ok: false, problem: ATTACHMENT_HELP });
    }
  });
});
