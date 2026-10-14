import { type KeyboardEvent, type PointerEvent, type Ref, useEffect, useRef, useState } from 'react';
import { checkCoverFile } from '../uploads/limits';
import {
  clampCenter,
  COVER_ASPECTS,
  type CropView,
  MAX_ZOOM,
  MIN_ZOOM,
  type Point,
  renderCrop,
  shownSize,
} from '../uploads/crop';
import { Button } from './Button';
import styles from './CoverField.module.css';
import { TextField } from './TextField';

interface CoverFieldProps {
  ref?: Ref<HTMLInputElement>;
  label?: string;
  hint?: string;
  error?: string;
  // The picture to send: the one chosen, as framed in the editor; null when none is chosen. A picture that cannot be
  // opened for framing (or is not a valid cover) is passed on as it is, so the form can explain what is wrong with it.
  onChange: (file: File | null) => void;
}

interface Loaded {
  url: string;
  image: HTMLImageElement;
  name: string;
}

const KEY_STEP = 0.02;

// A cover picture field: choose a picture, then pick the shape of the frame, zoom and drag the picture into place.
export function CoverField({ ref, label = 'Cover image', hint, error, onChange }: CoverFieldProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [aspectId, setAspectId] = useState(COVER_ASPECTS[0]!.id);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [center, setCenter] = useState<Point>({ x: 0, y: 0 });
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; last: Point } | null>(null);
  // Only the newest framing is passed on, even when an older one finishes drawing later.
  const drawing = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const aspect = COVER_ASPECTS.find((option) => option.id === aspectId)!.ratio;
  const view: CropView | null = loaded
    ? { imageWidth: loaded.image.naturalWidth, imageHeight: loaded.image.naturalHeight, aspect, zoom, center }
    : null;
  const placed = view ? { ...view, center: clampCenter(view) } : null;

  // A new picture starts centred, at full size.
  function startFraming(next: Loaded | null) {
    setLoaded(next);
    setZoom(MIN_ZOOM);
    setCenter({ x: 0, y: 0 });
  }

  useEffect(() => {
    return () => {
      if (loaded) URL.revokeObjectURL(loaded.url);
    };
  }, [loaded]);

  function onFile(file: File | undefined) {
    drawing.current += 1;
    onChange(file ?? null);
    startFraming(null);
    if (!file || checkCoverFile(file) !== null) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) startFraming({ url, image, name: file.name });
      else URL.revokeObjectURL(url);
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  }

  const imageWidth = placed?.imageWidth;
  const imageHeight = placed?.imageHeight;
  const placedX = placed?.center.x;
  const placedY = placed?.center.y;
  useEffect(() => {
    if (!loaded || imageWidth === undefined || imageHeight === undefined || placedX === undefined || placedY === undefined) return;
    const run = ++drawing.current;
    // Short wait, so dragging does not draw a picture for every pixel it moves.
    const timer = setTimeout(() => {
      void renderCrop(loaded.image, { imageWidth, imageHeight, aspect, zoom, center: { x: placedX, y: placedY } }, loaded.name).then((file) => {
        if (file && run === drawing.current) onChangeRef.current(file);
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [loaded, imageWidth, imageHeight, aspect, zoom, placedX, placedY]);

  function move(dx: number, dy: number) {
    if (!view) return;
    setCenter(clampCenter({ ...view, center: { x: placed!.center.x + dx, y: placed!.center.y + dy } }));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!view) return;
    drag.current = { pointer: event.pointerId, last: { x: event.clientX, y: event.clientY } };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    const width = frame.current?.clientWidth;
    if (!current || current.pointer !== event.pointerId || !width) return;
    move((event.clientX - current.last.x) / width, (event.clientY - current.last.y) / width);
    current.last = { x: event.clientX, y: event.clientY };
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] }[event.key];
    if (!step) return;
    event.preventDefault();
    move(step[0]!, step[1]!);
  }

  function changeZoom(next: number) {
    if (!view) return;
    setZoom(next);
    setCenter(clampCenter({ ...view, zoom: next, center: placed!.center }));
  }

  function changeAspect(id: string) {
    const ratio = COVER_ASPECTS.find((option) => option.id === id)!.ratio;
    setAspectId(id);
    if (view) setCenter(clampCenter({ ...view, aspect: ratio, center: placed!.center }));
  }

  const size = placed ? shownSize(placed) : null;

  return (
    <div className={styles.root}>
      <TextField ref={ref} label={label} type="file" accept="image/jpeg,image/png,image/webp" hint={hint} error={error} onChange={(e) => onFile(e.target.files?.[0])} />
      {placed && size && loaded ? (
        <div className={styles.editor}>
          <div className={styles.aspects} role="group" aria-label="Shape of the cover">
            {COVER_ASPECTS.map((option) => (
              <Button key={option.id} variant="secondary" size="small" aria-pressed={option.id === aspectId} className={option.id === aspectId ? styles.on : undefined} onClick={() => changeAspect(option.id)}>
                {option.label}
              </Button>
            ))}
          </div>
          <div
            ref={frame}
            className={styles.frame}
            style={{ aspectRatio: String(aspect) }}
            role="group"
            tabIndex={0}
            aria-label="Cover preview. Drag the picture, or use the arrow keys, to choose what shows."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onKeyDown={onKeyDown}
          >
            <img
              className={styles.picture}
              src={loaded.url}
              alt=""
              draggable={false}
              style={{
                width: `${size.width * 100}%`,
                height: `${size.height * aspect * 100}%`,
                left: `${(0.5 + placed.center.x - size.width / 2) * 100}%`,
                top: `${(0.5 + (placed.center.y - size.height / 2) * aspect) * 100}%`,
              }}
            />
          </div>
          <div className={styles.zoom}>
            <span aria-hidden="true">Zoom</span>
            <input type="range" aria-label="Zoom" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => changeZoom(Number(e.target.value))} />
            <span aria-hidden="true">{Math.round(zoom * 100)}%</span>
          </div>
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              setZoom(MIN_ZOOM);
              setCenter({ x: 0, y: 0 });
            }}
          >
            Reset
          </Button>
        </div>
      ) : null}
    </div>
  );
}
