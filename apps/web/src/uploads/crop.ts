// The maths behind the cover editor. The frame is one unit wide and 1 / aspect units high; the picture is placed in it
// "cover" style (it always fills the frame) and can then be zoomed and moved. Everything here is in those frame units, so
// it does not depend on how large the frame is on the screen.

export interface CoverAspect {
  id: string;
  label: string;
  // Width divided by height.
  ratio: number;
}

export const COVER_ASPECTS: CoverAspect[] = [
  { id: '16:9', label: 'Wide 16:9', ratio: 16 / 9 },
  { id: '4:3', label: 'Standard 4:3', ratio: 4 / 3 },
  { id: '1:1', label: 'Square 1:1', ratio: 1 },
];

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
// The saved picture is never wider than this, and never enlarged beyond what the original has.
export const MAX_OUTPUT_WIDTH = 1600;

export interface Point {
  x: number;
  y: number;
}

export interface CropView {
  imageWidth: number;
  imageHeight: number;
  aspect: number;
  zoom: number;
  // Where the middle of the picture is, from the middle of the frame.
  center: Point;
}

// The size of the picture inside the frame, at this zoom.
export function shownSize({ imageWidth, imageHeight, aspect, zoom }: Omit<CropView, 'center'>): { width: number; height: number } {
  const fit = Math.max(1 / imageWidth, 1 / aspect / imageHeight);
  return { width: imageWidth * fit * zoom, height: imageHeight * fit * zoom };
}

// Keeps the picture covering the whole frame: it cannot be dragged far enough to show an empty edge.
export function clampCenter(view: CropView): Point {
  const { width, height } = shownSize(view);
  const slackX = Math.max(0, (width - 1) / 2);
  const slackY = Math.max(0, (height - 1 / view.aspect) / 2);
  return {
    x: Math.min(slackX, Math.max(-slackX, view.center.x)),
    y: Math.min(slackY, Math.max(-slackY, view.center.y)),
  };
}

// The part of the original picture that the frame shows, in the pixels of the original.
export function sourceRect(view: CropView): { x: number; y: number; width: number; height: number } {
  const { width, height } = shownSize(view);
  const center = clampCenter(view);
  const perUnitX = view.imageWidth / width;
  const perUnitY = view.imageHeight / height;
  return {
    x: (width / 2 - 0.5 - center.x) * perUnitX,
    y: (height / 2 - 0.5 / view.aspect - center.y) * perUnitY,
    width: perUnitX,
    height: (1 / view.aspect) * perUnitY,
  };
}

// The size of the saved picture.
export function outputSize(view: CropView): { width: number; height: number } {
  const width = Math.max(1, Math.min(MAX_OUTPUT_WIDTH, Math.floor(sourceRect(view).width)));
  return { width, height: Math.max(1, Math.round(width / view.aspect)) };
}

// "photo.png" becomes "photo.jpg": the cropped picture is saved as a JPEG.
export function croppedName(original: string): string {
  const base = original.replace(/\.[^.]+$/, '') || 'cover';
  return `${base}.jpg`;
}

// Draws the part of the picture the frame shows and returns it as a JPEG file, or null if the browser cannot.
export async function renderCrop(image: CanvasImageSource, view: CropView, originalName: string): Promise<File | null> {
  const source = sourceRect(view);
  const size = outputSize(view);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  // A transparent PNG would turn black as a JPEG.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  return blob ? new File([blob], croppedName(originalName), { type: 'image/jpeg' }) : null;
}
