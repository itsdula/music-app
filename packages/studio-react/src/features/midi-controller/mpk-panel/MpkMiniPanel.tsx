import type { DeviceLayoutElement } from '@studio/midi-core';
import { MPK_MINI_MK3_LAYOUT, MPK_MINI_MK3_PANEL_LEGENDS } from '@studio/midi-akai-mpk-mini-mk3';
import { useId, type KeyboardEvent, type PointerEvent, type Ref } from 'react';

/** viewBox width; the height follows the device's 1.75 : 1 footprint. */
export const MPK_PANEL_WIDTH = 1000;
export const MPK_PANEL_HEIGHT = MPK_PANEL_WIDTH / MPK_MINI_MK3_LAYOUT.aspectRatio;

const W = MPK_PANEL_WIDTH;
const H = MPK_PANEL_HEIGHT;

/** Our palette in place of the hardware's red: accent for bank A, teal for bank B. */
export const MPK_PAD_COLORS = { A: '#8B7CF6', B: '#3CC8B4' } as const;
const ACCENT = '#8B7CF6';
const ACCENT_STRONG = '#A397FF';

/** Buttons each printed group outline surrounds (the layout's legend rects are approximate). */
const LEGEND_GROUPS: Readonly<Record<string, readonly string[]>> = {
  'legend.arpeggiator': ['button.arpOnOff', 'button.tapTempo'],
  'legend.padControls': [
    'button.bankAB',
    'button.padCC',
    'button.padProgramChange',
    'button.programSelect',
  ],
};

function groupOutline(legendId: string, fallback: { x: number; y: number; w: number; h: number }) {
  const members = MPK_MINI_MK3_LAYOUT.elements.filter((e) =>
    LEGEND_GROUPS[legendId]?.includes(e.controlId),
  );
  if (members.length === 0) return fallback;
  const x0 = Math.min(...members.map((e) => e.rect.x)) * W - 7;
  const y0 = Math.min(...members.map((e) => e.rect.y)) * H - 9;
  const x1 = Math.max(...members.map((e) => e.rect.x + e.rect.w)) * W + 7;
  const y1 = Math.max(...members.map((e) => e.rect.y + e.rect.h)) * H + 6;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const KEYS_TOP = Math.min(
  ...MPK_MINI_MK3_LAYOUT.elements.filter((e) => e.shape === 'key-white').map((e) => e.rect.y),
);

function px(el: DeviceLayoutElement) {
  return { x: el.rect.x * W, y: el.rect.y * H, w: el.rect.w * W, h: el.rect.h * H };
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** Accessible name of a layout element, e.g. "Key 3 (1/8)", "PAD 5", "K2". */
export function mpkControlLabel(el: DeviceLayoutElement): string {
  if (el.shape === 'key-white' || el.shape === 'key-black') {
    const key = `Key ${Number(el.controlId.split('.')[1]) + 1}`;
    // The printed legend sits above the key, so it is part of the name (WCAG 2.5.3).
    return el.secondaryLegend ? `${key} (${el.secondaryLegend})` : key;
  }
  if (el.shape === 'pad') return el.legend ?? 'Pad';
  if (el.shape === 'joystick') return 'Joystick';
  if (el.shape === 'display') return 'OLED display';
  return el.legend ?? el.controlId;
}

/** Note name of a keybed key id (`key.0` is the lowest C), e.g. "C", "F♯". */
export function mpkKeyNoteName(controlId: string): string {
  return NOTE_NAMES[Number(controlId.split('.')[1]) % 12] ?? '';
}

export interface MpkMiniPanelProps {
  /** Accessible name of the whole drawing. */
  label: string;
  className?: string;
  /** Layout id drawn with a selection ring. */
  selectedId?: string | null;
  /**
   * Makes every control a button that selects it (the Studio's controller inspector).
   * Without it, and without `onPress`, the drawing is a picture.
   */
  onSelect?: (layoutId: string) => void;
  /** Makes keys and pads playable: called on press and release (pointer, Enter or Space). */
  onPress?: (layoutId: string, down: boolean) => void;
  /** Colour of the pad lights. */
  padBank?: 'A' | 'B';
  /** Receives each control's `<g>` so a caller can set `data-active` / move indicators per frame. */
  registerNode?: (layoutId: string, node: SVGGElement | null) => void;
  oledRef?: Ref<SVGTextElement>;
  oledText?: string;
  testId?: string;
}

/**
 * An original 2D drawing of the MPK Mini MK3 top panel seen from above: matte body with accent
 * side cheeks, rubber pads and buttons, knurled knobs and a full keybed. Proportions come from
 * `MPK_MINI_MK3_LAYOUT`; no photo, logo or wordmark is used.
 *
 * Live state is driven from outside React: set `data-active="true"` on a control's `<g>` (from
 * `registerNode`), rotate its `[data-indicator]` (knobs) or move its `[data-cap]` (joystick).
 * Styles are scoped to the SVG, so it renders the same in the Studio and on the website.
 */
export function MpkMiniPanel({
  label,
  className,
  selectedId = null,
  onSelect,
  onPress,
  padBank = 'A',
  registerNode,
  oledRef,
  oledText = 'Nawa · ready',
  testId,
}: MpkMiniPanelProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (name: string) => `mpk-${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;

  const controlProps = (el: DeviceLayoutElement) => {
    const playable = onPress && (el.shape === 'pad' || el.shape.startsWith('key'));
    const selectable = onSelect && el.shape !== 'display';
    const interactive = Boolean(playable || selectable);
    const press = (down: boolean) => onPress?.(el.controlId, down);
    return {
      ref: (node: SVGGElement | null) => registerNode?.(el.controlId, node),
      'data-control': el.controlId,
      'data-active': 'false',
      ...(interactive
        ? {
            tabIndex: 0,
            role: 'button',
            'aria-label': mpkControlLabel(el),
            ...(selectable ? { 'aria-pressed': selectedId === el.controlId } : {}),
            onClick: selectable ? () => onSelect?.(el.controlId) : undefined,
            onPointerDown: playable
              ? (e: PointerEvent<SVGGElement>) => {
                  try {
                    // Keep the release on this control even if the pointer slides off it.
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // Synthetic events have no active pointer to capture.
                  }
                  press(true);
                }
              : undefined,
            onPointerUp: playable ? () => press(false) : undefined,
            onPointerCancel: playable ? () => press(false) : undefined,
            onKeyDown: (e: KeyboardEvent<SVGGElement>) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              if (selectable) onSelect?.(el.controlId);
              if (playable && !e.repeat) press(true);
            },
            onKeyUp: playable
              ? (e: KeyboardEvent<SVGGElement>) => {
                  if (e.key === 'Enter' || e.key === ' ') press(false);
                }
              : undefined,
          }
        : { 'aria-hidden': true }),
    };
  };

  const ring = (el: DeviceLayoutElement, radius = 8) => {
    if (selectedId !== el.controlId) return null;
    const r = px(el);
    return (
      <rect
        x={r.x - 4}
        y={r.y - 4}
        width={r.w + 8}
        height={r.h + 8}
        rx={radius}
        fill="none"
        stroke={ACCENT_STRONG}
        strokeWidth={3}
        pointerEvents="none"
      />
    );
  };

  const whiteKeys = MPK_MINI_MK3_LAYOUT.elements.filter((e) => e.shape === 'key-white');
  const blackKeys = MPK_MINI_MK3_LAYOUT.elements.filter((e) => e.shape === 'key-black');
  const others = MPK_MINI_MK3_LAYOUT.elements.filter((e) => !e.shape.startsWith('key'));
  const keyLegends = MPK_MINI_MK3_LAYOUT.elements.filter(
    (e) => e.shape.startsWith('key') && e.secondaryLegend,
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="group"
      aria-label={label}
      data-testid={testId}
      preserveAspectRatio="xMidYMid meet"
      style={{ fontFamily: 'inherit' }}
    >
      <style>{`
        .mpk-c { cursor: ${onSelect || onPress ? 'pointer' : 'default'}; outline: none; }
        .mpk-c:focus-visible .mpk-focus { stroke: ${ACCENT_STRONG}; stroke-width: 3; }
        .mpk-c .mpk-light { opacity: 0.06; transition: opacity 120ms ease-out; }
        .mpk-c[data-active='true'] .mpk-light { opacity: 0.95; filter: url(#${id('glow')}); transition-duration: 30ms; }
        .mpk-c[data-active='true'] .mpk-key-face { fill: ${ACCENT}; }
        .mpk-c[data-active='true'] .mpk-key-white-face { transform: translateY(2px); }
        .mpk-c[data-active='true'] .mpk-knob-rim { stroke: ${ACCENT_STRONG}; }
        .mpk-c[data-active='true'] .mpk-button-face { fill: #3a3e48; }
        .mpk-c[data-bank='B'] .mpk-light { fill: ${MPK_PAD_COLORS.B}; }
        .mpk-c[data-bank='A'] .mpk-light { fill: ${MPK_PAD_COLORS.A}; }
        .mpk-c [data-indicator], .mpk-c [data-cap] { transition: transform 60ms linear; }
        @media (prefers-reduced-motion: reduce) {
          .mpk-c *, .mpk-c [data-indicator], .mpk-c [data-cap] { transition: none !important; }
        }
      `}</style>
      <defs>
        <linearGradient id={id('body')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a1b20" />
          <stop offset="0.5" stopColor="#131418" />
          <stop offset="1" stopColor="#0c0d10" />
        </linearGradient>
        <filter id={id('matte')} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <linearGradient id={id('cheek')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5b4cd6" />
          <stop offset="0.45" stopColor={ACCENT} />
          <stop offset="1" stopColor="#4a3dbb" />
        </linearGradient>
        <radialGradient id={id('ball')} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#c9c1ff" />
          <stop offset="0.35" stopColor={ACCENT} />
          <stop offset="1" stopColor="#3f3399" />
        </radialGradient>
        <linearGradient id={id('pad')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#45474e" />
          <stop offset="1" stopColor="#36383e" />
        </linearGradient>
        <linearGradient id={id('button')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c2e35" />
          <stop offset="1" stopColor="#1d1f24" />
        </linearGradient>
        <radialGradient id={id('knob')} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#3b3e46" />
          <stop offset="0.7" stopColor="#1b1d22" />
          <stop offset="1" stopColor="#111216" />
        </radialGradient>
        <linearGradient id={id('white')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9dbe0" />
          <stop offset="0.08" stopColor="#f6f7f9" />
          <stop offset="1" stopColor="#e9eaee" />
        </linearGradient>
        <linearGradient id={id('black')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b0c0e" />
          <stop offset="0.85" stopColor="#24262c" />
          <stop offset="1" stopColor="#34373e" />
        </linearGradient>
        <linearGradient id={id('oled')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2368" />
          <stop offset="1" stopColor="#1a1545" />
        </linearGradient>
        <filter id={id('glow')} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={id('drop')} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#000" floodOpacity="0.6" />
        </filter>
      </defs>

      {/* Body, matte texture and accent side cheeks. */}
      <rect x={0} y={0} width={W} height={H} rx={18} fill={url('body')} />
      <rect x={0} y={0} width={W} height={H} rx={18} fill="#fff" filter={url('matte')} />
      <rect x={0} y={0} width={13} height={H} rx={6} fill={url('cheek')} />
      <rect x={W - 13} y={0} width={13} height={H} rx={6} fill={url('cheek')} />
      <rect x={13} y={1} width={W - 26} height={1.5} fill="#ffffff" opacity={0.06} />

      {/* Keybed recess. */}
      <rect
        x={W * 0.03}
        y={KEYS_TOP * H - 8}
        width={W * 0.94}
        height={H - KEYS_TOP * H + 2}
        rx={6}
        fill="#07080a"
      />

      {/* Printed group outlines and legends. */}
      {MPK_MINI_MK3_PANEL_LEGENDS.map((legend) => {
        const { x, y, w, h } = groupOutline(legend.id, {
          x: legend.rect.x * W,
          y: legend.rect.y * H,
          w: legend.rect.w * W,
          h: legend.rect.h * H,
        });
        return (
          <g key={legend.id} aria-hidden>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={5}
              fill="none"
              stroke="#d9dbe2"
              strokeOpacity={0.75}
              strokeWidth={1.2}
            />
            <rect
              x={x + w / 2 - legend.text.length * 3.6}
              y={y - 6}
              width={legend.text.length * 7.2}
              height={12}
              fill="#16171b"
            />
            <text
              x={x + w / 2}
              y={y + 3.5}
              fontSize={9.5}
              fill="#e6e7eb"
              letterSpacing={1.4}
              fontWeight={600}
              textAnchor="middle"
            >
              {legend.text}
            </text>
          </g>
        );
      })}

      {/* Legends printed above the keys (arpeggiator and note-repeat settings). */}
      {keyLegends.map((el) => {
        const r = px(el);
        const black = el.shape === 'key-black';
        return (
          <text
            key={`legend-${el.controlId}`}
            aria-hidden
            x={r.x + r.w / 2}
            y={KEYS_TOP * H - (black ? 22 : 13)}
            fontSize={7}
            fill="#c9ccd4"
            textAnchor="middle"
            fontWeight={600}
            letterSpacing={0.3}
          >
            {el.secondaryLegend}
          </text>
        );
      })}

      {others.map((el) => {
        const r = px(el);
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        switch (el.shape) {
          case 'display':
            return (
              <g
                key={el.controlId}
                ref={(node) => registerNode?.(el.controlId, node)}
                data-control={el.controlId}
                className="mpk-c"
                role="img"
                aria-label={mpkControlLabel(el)}
              >
                <rect
                  x={r.x - 3}
                  y={r.y - 3}
                  width={r.w + 6}
                  height={r.h + 6}
                  rx={5}
                  fill="#050507"
                />
                <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={3} fill={url('oled')} />
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h * 0.45}
                  rx={3}
                  fill="#fff"
                  opacity={0.05}
                />
                <text
                  ref={oledRef}
                  x={r.x + 7}
                  y={cy + 4}
                  fontSize={10}
                  fill="#d6d0ff"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                >
                  {oledText}
                </text>
              </g>
            );
          case 'joystick':
            return (
              <g key={el.controlId} {...controlProps(el)} className="mpk-c">
                {ring(el, r.w)}
                <circle
                  className="mpk-focus"
                  cx={cx}
                  cy={cy}
                  r={r.w / 2 + 2}
                  fill="#060608"
                  stroke="transparent"
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={r.w / 2 - 2}
                  fill="#0d0e11"
                  stroke="#2a2c33"
                  strokeWidth={1.5}
                />
                <g transform={`translate(${cx} ${cy})`}>
                  <g data-cap>
                    <circle r={r.w * 0.36} cy={3} fill="#000" opacity={0.5} />
                    <circle r={r.w * 0.36} fill={url('ball')} />
                    <circle r={r.w * 0.36} fill="none" stroke="#fff" strokeOpacity={0.15} />
                  </g>
                </g>
              </g>
            );
          case 'knob': {
            const rim = r.w / 2;
            return (
              <g key={el.controlId} {...controlProps(el)} className="mpk-c">
                {ring(el, rim + 4)}
                <circle cx={cx} cy={cy + 3} r={rim} fill="#000" opacity={0.55} />
                <circle
                  className="mpk-knob-rim mpk-focus"
                  cx={cx}
                  cy={cy}
                  r={rim - 2}
                  fill="#15161a"
                  stroke="#2b2d33"
                  strokeWidth={4}
                  strokeDasharray="2 2.2"
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={rim * 0.72}
                  fill={url('knob')}
                  stroke="#3a3d45"
                  strokeWidth={1}
                />
                <g transform={`translate(${cx} ${cy})`}>
                  <line
                    data-indicator
                    x1={0}
                    y1={-rim * 0.2}
                    x2={0}
                    y2={-rim * 0.68}
                    stroke="#f4f5f7"
                    strokeWidth={3}
                    strokeLinecap="round"
                    transform="rotate(-135)"
                  />
                </g>
                <rect
                  x={cx - 13}
                  y={r.y + r.h + 6}
                  width={26}
                  height={12}
                  rx={3}
                  fill="none"
                  stroke="#c9ccd4"
                  strokeOpacity={0.6}
                />
                <text
                  x={cx}
                  y={r.y + r.h + 15}
                  fontSize={8}
                  fill="#e6e7eb"
                  textAnchor="middle"
                  fontWeight={700}
                >
                  {el.legend}
                </text>
              </g>
            );
          }
          case 'pad':
            return (
              <g key={el.controlId} {...controlProps(el)} className="mpk-c" data-bank={padBank}>
                {ring(el)}
                <text
                  x={r.x + 2}
                  y={r.y - 5}
                  fontSize={8}
                  fill="#c9ccd4"
                  fontWeight={600}
                  letterSpacing={0.6}
                >
                  {el.legend}
                </text>
                <rect
                  x={r.x}
                  y={r.y + 3}
                  width={r.w}
                  height={r.h}
                  rx={7}
                  fill="#000"
                  opacity={0.55}
                />
                <rect
                  className="mpk-focus"
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  rx={7}
                  fill={url('pad')}
                  stroke="#55575f"
                  strokeOpacity={0.5}
                />
                <rect
                  className="mpk-light"
                  x={r.x + 3}
                  y={r.y + 3}
                  width={r.w - 6}
                  height={r.h - 6}
                  rx={5}
                  fill={MPK_PAD_COLORS[padBank]}
                />
              </g>
            );
          case 'button':
            return (
              <g key={el.controlId} {...controlProps(el)} className="mpk-c">
                {ring(el, 5)}
                <rect
                  x={r.x}
                  y={r.y + 2}
                  width={r.w}
                  height={r.h * 0.62}
                  rx={4}
                  fill="#000"
                  opacity={0.6}
                />
                <rect
                  className="mpk-button-face mpk-focus"
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h * 0.62}
                  rx={4}
                  fill={url('button')}
                  stroke="#3a3c44"
                />
                <text
                  x={cx}
                  y={r.y + r.h * 0.62 + 9}
                  fontSize={el.legend && el.legend.length > 9 ? 5.6 : 6.6}
                  fill="#d3d6dd"
                  textAnchor="middle"
                  fontWeight={600}
                  letterSpacing={0.4}
                >
                  {el.legend}
                </text>
              </g>
            );
          default:
            return null;
        }
      })}

      {/* Keybed: white keys first, black keys drawn on top. */}
      {whiteKeys.map((el) => {
        const r = px(el);
        return (
          <g key={el.controlId} {...controlProps(el)} className="mpk-c">
            <g className="mpk-key-white-face">
              <rect x={r.x + 1} y={r.y} width={r.w - 2} height={r.h} rx={3} fill="#a9acb4" />
              <rect
                className="mpk-key-face mpk-focus"
                x={r.x + 1}
                y={r.y}
                width={r.w - 2}
                height={r.h - 5}
                rx={3}
                fill={url('white')}
              />
            </g>
            {ring(el, 3)}
          </g>
        );
      })}
      {blackKeys.map((el) => {
        const r = px(el);
        return (
          <g key={el.controlId} {...controlProps(el)} className="mpk-c">
            <rect
              x={r.x - 1}
              y={r.y}
              width={r.w + 2}
              height={r.h + 3}
              rx={3}
              fill="#000"
              opacity={0.45}
            />
            <rect
              className="mpk-key-face mpk-focus"
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              rx={2.5}
              fill={url('black')}
            />
            <rect
              x={r.x + 3}
              y={r.y + 2}
              width={r.w - 6}
              height={r.h * 0.7}
              rx={2}
              fill="#fff"
              opacity={0.05}
              pointerEvents="none"
            />
            {ring(el, 3)}
          </g>
        );
      })}
    </svg>
  );
}
