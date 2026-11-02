import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cx, focusRing } from './primitives';

export interface DemoKnobProps {
  label: string;
  /** Normalised position, 0..1. */
  value: number;
  onChange: (value: number) => void;
  /** Position restored on double-click. */
  defaultValue: number;
  /** Human-readable value for the readout and for assistive tech, e.g. "1.2 kHz". */
  format: (value: number) => string;
}

const ARC = 0.75; // the knob sweeps 270 degrees
const DRAG_PIXELS = 180; // a full sweep takes this much vertical travel; Shift is 5x finer
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Two taps this close together reset the knob (touch browsers do not all fire dblclick). */
const DOUBLE_TAP_MS = 300;

/**
 * A rotary knob for the landing demo. It is a real slider: role="slider" with the value
 * exposed, arrow keys and Page Up/Down to step, Home/End for the ends, vertical drag with
 * the pointer (captured, so the drag survives leaving the knob), double-click or
 * double-tap to reset.
 * The rotation is a transform on the indicator; the value arc is a stroke-dash change.
 */
export function DemoKnob({ label, value, onChange, defaultValue, format }: DemoKnobProps) {
  const drag = useRef<{ y: number; value: number } | null>(null);
  const lastTap = useRef(0);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      const now = event.timeStamp;
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        lastTap.current = 0;
        onChange(defaultValue);
        return;
      }
      lastTap.current = now;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    drag.current = { y: event.clientY, value };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const scale = event.shiftKey ? DRAG_PIXELS * 5 : DRAG_PIXELS;
    onChange(clamp01(drag.current.value + (drag.current.y - event.clientY) / scale));
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.002 : 0.02;
    const next: Record<string, number> = {
      ArrowUp: value + step,
      ArrowRight: value + step,
      ArrowDown: value - step,
      ArrowLeft: value - step,
      PageUp: value + 0.1,
      PageDown: value - 0.1,
      Home: 0,
      End: 1,
    };
    const target = next[event.key];
    if (target === undefined) return;
    event.preventDefault();
    onChange(clamp01(target));
  };

  const angle = -135 + value * 270;
  const text = format(value);

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={text}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onDoubleClick={() => onChange(defaultValue)}
        className={cx(
          'group relative size-16 min-[400px]:size-[76px] cursor-ns-resize touch-none rounded-full select-none sm:size-[88px]',
          focusRing,
        )}
      >
        <svg viewBox="0 0 88 88" className="size-full" aria-hidden="true">
          <defs>
            <radialGradient id="nawa-knob-cap" cx="0.35" cy="0.3" r="0.9">
              <stop offset="0" stopColor="#3a3f4c" />
              <stop offset="0.6" stopColor="#1d2028" />
              <stop offset="1" stopColor="#121419" />
            </radialGradient>
            <linearGradient id="nawa-knob-arc" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#8b7cf6" />
              <stop offset="1" stopColor="#c9c1ff" />
            </linearGradient>
          </defs>
          {/* Track and value arcs: a 270-degree sweep starting at the lower left. */}
          <circle
            cx="44"
            cy="44"
            r="39"
            fill="none"
            stroke="rgb(255 255 255 / 0.08)"
            strokeWidth="3"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${ARC * 100} 100`}
            transform="rotate(135 44 44)"
          />
          <circle
            cx="44"
            cy="44"
            r="39"
            fill="none"
            stroke="url(#nawa-knob-arc)"
            strokeWidth="3"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${Math.max(0.001, ARC * value * 100)} 100`}
            transform="rotate(135 44 44)"
            className="drop-shadow-[0_0_6px_rgb(139_124_246/0.6)]"
          />
          <circle cx="44" cy="44" r="30" fill="url(#nawa-knob-cap)" />
          <circle
            cx="44"
            cy="44"
            r="30"
            fill="none"
            stroke="rgb(255 255 255 / 0.10)"
            strokeWidth="1"
          />
          <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '44px 44px' }}>
            <line
              x1="44"
              y1="20"
              x2="44"
              y2="30"
              stroke="#f2f3f5"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>
        </svg>
        <span className="pointer-events-none absolute inset-[18%] rounded-full opacity-0 shadow-[0_0_30px_rgb(139_124_246/0.45)] transition-opacity duration-300 group-hover:opacity-100 group-active:opacity-100" />
      </div>
      <div className="text-center">
        <p className="font-mono text-[10px] tracking-[0.06em] text-text-muted uppercase sm:tracking-[0.16em]">
          {label}
        </p>
        <p aria-hidden="true" className="mt-0.5 font-mono text-xs text-text tabular-nums">
          {text}
        </p>
      </div>
    </div>
  );
}
