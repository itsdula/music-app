import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { cn } from '../lib/cn';
import { amplitudeToDb, clamp } from '../lib/math';
import { focusRing } from '../lib/styles';
import { colors } from '../tokens';

export const METER_MIN_DB = -60;
export const METER_MAX_DB = 6;

export interface MeterHandle {
  /**
   * Pushes new per-channel linear peak amplitudes (1.0 = 0 dBFS) and whether the source
   * clipped since the last call. Draws immediately without a React render; call it from
   * requestAnimationFrame.
   */
  setLevels: (levels: readonly number[], clipped: boolean) => void;
  /** Clears levels, peak holds and the clip latch. */
  reset: () => void;
}

export interface MeterProps {
  ref?: Ref<MeterHandle>;
  /** Accessible name, e.g. "Master level". */
  label: string;
  orientation?: 'vertical' | 'horizontal';
  /** Number of bars drawn before the first `setLevels`. Default 2. */
  channels?: number;
  /** How long a peak marker holds before decaying (ms). Default 1000. */
  peakHoldMs?: number;
  /** Fall-off rate of the bars and released peak markers (dB per second). Default 24. */
  decayDbPerSecond?: number;
  /** Show the clip indicator (latches until clicked). Default true. */
  showClip?: boolean;
  /** Called when the user clears the clip latch. */
  onClipReset?: () => void;
  className?: string;
}

interface ChannelState {
  level: number;
  peak: number;
  peakAt: number;
}

const TICKS_DB = [0, -6, -12, -24, -36, -48];

/** Maps dB to 0..1 on the meter's linear-in-dB scale (−60..+6). */
export function dbToMeterPosition(db: number): number {
  return clamp((db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB), 0, 1);
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function silentChannel(): ChannelState {
  return { level: METER_MIN_DB, peak: METER_MIN_DB, peakAt: 0 };
}

/**
 * Canvas level meter driven imperatively through its ref (`setLevels`) so parents can update
 * it every animation frame without re-rendering. Peak hold with decay; clip latch until clicked.
 */
export function Meter({
  ref,
  label,
  orientation = 'vertical',
  channels = 2,
  peakHoldMs = 1000,
  decayDbPerSecond = 24,
  showClip = true,
  onClipReset,
  className,
}: MeterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const channelsRef = useRef<ChannelState[]>([]);
  const lastUpdateRef = useRef(0);
  const latchedRef = useRef(false);
  const [clipLatched, setClipLatched] = useState(false);
  const vertical = orientation === 'vertical';

  const draw = (): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const state = channelsRef.current.length
      ? channelsRef.current
      : Array.from({ length: Math.max(1, channels) }, silentChannel);
    const count = state.length;
    const length = vertical ? height : width;
    const thickness = vertical ? width : height;
    const gap = count > 1 ? Math.max(1, Math.round(thickness * 0.12)) : 0;
    const bar = Math.max(1, (thickness - gap * (count - 1)) / count);

    ctx.clearRect(0, 0, width, height);

    const gradient = vertical
      ? ctx.createLinearGradient(0, height, 0, 0)
      : ctx.createLinearGradient(0, 0, width, 0);
    const warnAt = dbToMeterPosition(-12);
    const hotAt = dbToMeterPosition(0);
    gradient.addColorStop(0, colors.success);
    gradient.addColorStop(warnAt, colors.success);
    gradient.addColorStop(Math.min(1, warnAt + 0.02), colors.warning);
    gradient.addColorStop(hotAt, colors.warning);
    gradient.addColorStop(Math.min(1, hotAt + 0.01), colors.record);
    gradient.addColorStop(1, colors.record);

    // Fills a span along the meter axis (from/to are 0..1 positions) for one channel.
    const span = (index: number, from: number, to: number): void => {
      const offset = index * (bar + gap);
      const start = from * length;
      const size = Math.max(0, (to - from) * length);
      if (vertical) ctx.fillRect(offset, height - start - size, bar, size);
      else ctx.fillRect(start, offset, size, bar);
    };

    state.forEach((channel, index) => {
      ctx.fillStyle = colors.surface0;
      span(index, 0, 1);
      ctx.fillStyle = gradient;
      span(index, 0, dbToMeterPosition(channel.level));
      if (channel.peak > METER_MIN_DB) {
        const p = dbToMeterPosition(channel.peak);
        const markerSize = Math.max(1, Math.round(length * 0.012)) / length;
        ctx.fillStyle = channel.peak >= 0 ? colors.record : colors.text;
        span(index, Math.max(0, p - markerSize), p);
      }
    });

    ctx.fillStyle = colors.surface1;
    for (const db of TICKS_DB) {
      const p = Math.round(dbToMeterPosition(db) * length);
      if (vertical) ctx.fillRect(0, height - p, width, 1);
      else ctx.fillRect(p, 0, 1, height);
    }
  };

  const latch = (value: boolean): void => {
    if (latchedRef.current === value) return;
    latchedRef.current = value;
    setClipLatched(value);
  };

  useImperativeHandle(ref, () => ({
    setLevels(levels, clipped) {
      const time = now();
      const elapsed = lastUpdateRef.current ? (time - lastUpdateRef.current) / 1000 : 0;
      lastUpdateRef.current = time;
      const fall = decayDbPerSecond * Math.min(elapsed, 0.25);
      const previous = channelsRef.current;
      channelsRef.current = levels.map((amplitude, index) => {
        const db = clamp(amplitudeToDb(Math.abs(amplitude)), METER_MIN_DB, METER_MAX_DB);
        const prev = previous[index] ?? silentChannel();
        const level = Math.max(db, prev.level - fall);
        let { peak, peakAt } = prev;
        if (db >= peak) {
          peak = db;
          peakAt = time;
        } else if (time - peakAt > peakHoldMs) {
          peak = Math.max(db, level, peak - fall);
        }
        return { level, peak, peakAt };
      });
      if (clipped) latch(true);
      draw();
    },
    reset() {
      channelsRef.current = [];
      lastUpdateRef.current = 0;
      latch(false);
      draw();
    },
  }));

  const redraw = useEffectEvent(draw);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = (): void => {
      const ratio =
        typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * ratio));
      const h = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      redraw();
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [vertical, channels]);

  const resetClip = (): void => {
    latch(false);
    onClipReset?.();
  };

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 gap-0.5',
        vertical ? 'h-32 w-2.5 flex-col' : 'h-2.5 w-32 flex-row-reverse',
        className,
      )}
    >
      {showClip ? (
        <button
          type="button"
          aria-label={clipLatched ? `${label}: clipped, click to reset` : `${label}: no clip`}
          data-clipped={clipLatched || undefined}
          disabled={!clipLatched}
          onClick={resetClip}
          className={cn(
            'shrink-0 rounded-[1px] disabled:cursor-default',
            vertical ? 'h-1.5 w-full' : 'h-full w-1.5',
            clipLatched ? 'bg-record' : 'bg-surface-3',
            focusRing,
          )}
        />
      ) : null}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="block min-h-0 min-w-0 flex-1 rounded-[1px]"
      />
    </div>
  );
}
