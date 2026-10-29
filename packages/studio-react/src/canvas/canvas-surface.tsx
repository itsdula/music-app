import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type HTMLAttributes,
  type Ref,
} from 'react';

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export type DrawFunction = (ctx: CanvasRenderingContext2D, size: CanvasSize) => void;

export interface CanvasSurfaceHandle {
  /** Requests a redraw on the next animation frame (coalesced). */
  invalidate(): void;
  readonly canvas: HTMLCanvasElement | null;
  getSize(): CanvasSize;
}

export interface CanvasSurfaceProps extends Omit<HTMLAttributes<HTMLCanvasElement>, 'children'> {
  readonly draw: DrawFunction;
  /** Any value whose change should trigger a redraw (e.g. a view-model object). */
  readonly version?: unknown;
  readonly ref?: Ref<CanvasSurfaceHandle>;
  /** Called after the canvas CSS size changes. */
  readonly onResize?: (size: CanvasSize) => void;
}

/**
 * A HiDPI-aware canvas that redraws when its size or `version` changes. Drawing happens in
 * device-independent pixels (the context is pre-scaled by devicePixelRatio).
 */
export function CanvasSurface({
  draw,
  version,
  ref,
  onResize,
  style,
  ...rest
}: CanvasSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef<CanvasSize>({ width: 0, height: 0, dpr: 1 });
  const frameRef = useRef<number | null>(null);
  const drawRef = useRef(draw);
  const onResizeRef = useRef(onResize);

  useEffect(() => {
    drawRef.current = draw;
    onResizeRef.current = onResize;
  });

  const paint = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height, dpr } = sizeRef.current;
    if (width === 0 || height === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawRef.current(ctx, sizeRef.current);
  }, []);

  const invalidate = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(paint);
  }, [paint]);

  useImperativeHandle(
    ref,
    () => ({
      invalidate,
      get canvas() {
        return canvasRef.current;
      },
      getSize: () => sizeRef.current,
    }),
    [invalidate],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(0, Math.round(entry.contentRect.width));
      const height = Math.max(0, Math.round(entry.contentRect.height));
      const size = { width, height, dpr };
      sizeRef.current = size;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      onResizeRef.current?.(size);
      paint();
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [paint]);

  useEffect(() => {
    invalidate();
  }, [version, draw, invalidate]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%', ...style }}
      {...rest}
    />
  );
}
