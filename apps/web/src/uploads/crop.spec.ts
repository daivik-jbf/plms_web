import { describe, expect, it } from 'vitest';
import { clampCenter, croppedName, MAX_OUTPUT_WIDTH, outputSize, shownSize, sourceRect, type CropView } from './crop';

const wide = (over: Partial<CropView> = {}): CropView => ({ imageWidth: 2000, imageHeight: 1000, aspect: 1, zoom: 1, center: { x: 0, y: 0 }, ...over });

describe('cover framing', () => {
  it('fills the frame, so a wide picture in a square frame is as wide as two frames', () => {
    expect(shownSize(wide())).toEqual({ width: 2, height: 1 });
    expect(shownSize(wide({ zoom: 2 }))).toEqual({ width: 4, height: 2 });
  });

  it('shows the middle of the picture at first, and a smaller part when zoomed in', () => {
    expect(sourceRect(wide())).toEqual({ x: 500, y: 0, width: 1000, height: 1000 });
    expect(sourceRect(wide({ zoom: 2 }))).toEqual({ x: 750, y: 250, width: 500, height: 500 });
  });

  it('follows the picture when it is moved, and never shows an empty edge', () => {
    expect(clampCenter(wide({ center: { x: 10, y: 10 } }))).toEqual({ x: 0.5, y: 0 });
    expect(sourceRect(wide({ center: { x: 10, y: 0 } })).x).toBe(0);
    expect(sourceRect(wide({ center: { x: -10, y: 0 } })).x).toBe(1000);
  });

  it('keeps the shape of the frame in the saved picture and never enlarges the original', () => {
    expect(outputSize(wide({ aspect: 16 / 9 }))).toEqual({ width: 1600, height: 900 });
    expect(outputSize(wide({ imageWidth: 800, imageHeight: 800, aspect: 1 }))).toEqual({ width: 800, height: 800 });
    expect(outputSize(wide({ imageWidth: 10_000, imageHeight: 10_000 })).width).toBe(MAX_OUTPUT_WIDTH);
  });

  it('names the saved picture as a JPEG', () => {
    expect(croppedName('holiday photo.PNG')).toBe('holiday photo.jpg');
    expect(croppedName('')).toBe('cover.jpg');
  });
});
