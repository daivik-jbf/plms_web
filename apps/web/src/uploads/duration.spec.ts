import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDuration } from './duration';

describe('readDuration', () => {
  let media: HTMLMediaElement;
  let created: string[];

  beforeEach(() => {
    created = [];
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const element = create(tag, options);
      if (tag === 'video' || tag === 'audio') {
        media = element as HTMLMediaElement;
        created.push(tag);
      }
      return element;
    });
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const video = new File(['x'], 'a.mp4', { type: 'video/mp4' });
  const song = new File(['x'], 'a.mp3', { type: 'audio/mpeg' });

  it('reads the length in whole seconds from the file itself and lets the file go', async () => {
    const result = readDuration(video, 'video');
    Object.defineProperty(media, 'duration', { value: 724.4, configurable: true });
    media.dispatchEvent(new Event('loadedmetadata'));
    await expect(result).resolves.toBe(724);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(created).toEqual(['video']);
  });

  it('opens an audio file in an audio element', async () => {
    const result = readDuration(song, 'audio');
    Object.defineProperty(media, 'duration', { value: 185.6, configurable: true });
    media.dispatchEvent(new Event('loadedmetadata'));
    await expect(result).resolves.toBe(186);
    expect(created).toEqual(['audio']);
  });

  it('answers null when the browser cannot read the file', async () => {
    const result = readDuration(video, 'video');
    media.dispatchEvent(new Event('error'));
    await expect(result).resolves.toBeNull();
  });

  it.each([Number.POSITIVE_INFINITY, Number.NaN])('answers null for a length of %s', async (value) => {
    const result = readDuration(song, 'audio');
    Object.defineProperty(media, 'duration', { value, configurable: true });
    media.dispatchEvent(new Event('loadedmetadata'));
    await expect(result).resolves.toBeNull();
  });

  it('gives up after ten seconds', async () => {
    vi.useFakeTimers();
    const result = readDuration(song, 'audio');
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBeNull();
  });
});
