import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDuration } from './duration';

describe('readDuration', () => {
  let video: HTMLVideoElement;

  beforeEach(() => {
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const element = create(tag, options);
      if (tag === 'video') video = element as HTMLVideoElement;
      return element;
    });
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const file = new File(['x'], 'a.mp4', { type: 'video/mp4' });

  it('reads the length in whole seconds from the file itself and lets the file go', async () => {
    const result = readDuration(file);
    Object.defineProperty(video, 'duration', { value: 724.4, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));
    await expect(result).resolves.toBe(724);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('answers null when the browser cannot read the file', async () => {
    const result = readDuration(file);
    video.dispatchEvent(new Event('error'));
    await expect(result).resolves.toBeNull();
  });

  it('answers null for a length that is not a finite number', async () => {
    const result = readDuration(file);
    Object.defineProperty(video, 'duration', { value: Number.POSITIVE_INFINITY, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));
    await expect(result).resolves.toBeNull();
  });

  it('gives up after ten seconds', async () => {
    vi.useFakeTimers();
    const result = readDuration(file);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBeNull();
  });
});
