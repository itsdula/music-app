import type { DeviceLayoutElement } from '@studio/midi-core';
import {
  MPK_MINI_MK3_LAYOUT,
  MPK_MINI_MK3_PANEL_LEGENDS,
  controlIdsForLayoutElement,
} from '@studio/midi-akai-mpk-mini-mk3';
import { colors } from '@studio/ui';
import { useRef } from 'react';
import { useFrame } from '../../lib/use-frame';
import { useSession } from '../../session/context';

const W = 1000;
const H = W / MPK_MINI_MK3_LAYOUT.aspectRatio;

const PAD_COLORS = { A: '#F16D75', B: '#3CC8B4' } as const;

function px(el: DeviceLayoutElement) {
  return { x: el.rect.x * W, y: el.rect.y * H, w: el.rect.w * W, h: el.rect.h * H };
}

function labelFor(el: DeviceLayoutElement): string {
  if (el.shape === 'key-white' || el.shape === 'key-black') {
    const key = `Key ${Number(el.controlId.split('.')[1]) + 1}`;
    // The printed panel legend is visible on the key, so it must be part of the name (WCAG 2.5.3).
    return el.secondaryLegend ? `${key} (${el.secondaryLegend})` : key;
  }
  if (el.shape === 'pad') return el.legend ?? 'Pad';
  if (el.shape === 'joystick') return 'Joystick';
  if (el.shape === 'display') return 'OLED display';
  return el.legend ?? el.controlId;
}

/**
 * Original SVG drawing of the AKAI Professional MPK Mini MK3 top panel (proportions from the
 * research dossier; no photos or logos). Live MIDI activity is drawn from the render loop by
 * mutating SVG attributes directly, so incoming messages never re-render React.
 */
export function HardwareView({
  selectedLayoutId,
  onSelect,
  padBank,
}: {
  selectedLayoutId: string | null;
  onSelect: (layoutId: string) => void;
  padBank: 'A' | 'B';
}) {
  const session = useSession();
  const nodes = useRef(new Map<string, SVGGElement>());
  const drawn = useRef(new Map<string, number>());
  const oledRef = useRef<SVGTextElement>(null);
  const oledSeq = useRef(0);

  useFrame(() => {
    const activity = session.midi.activity;
    for (const el of MPK_MINI_MK3_LAYOUT.elements) {
      const node = nodes.current.get(el.controlId);
      if (!node) continue;
      const ids = controlIdsForLayoutElement(el.controlId);
      let latest: { value: number; timeMs: number; id: string } | null = null;
      for (const id of ids) {
        const a = activity.get(id);
        if (a && (!latest || a.timeMs > latest.timeMs)) latest = { ...a, id };
      }
      if (!latest || drawn.current.get(el.controlId) === latest.timeMs) continue;
      drawn.current.set(el.controlId, latest.timeMs);
      if (el.shape === 'knob') {
        const indicator = node.querySelector<SVGLineElement>('[data-indicator]');
        indicator?.setAttribute('transform', `rotate(${-135 + latest.value * 270})`);
        node.dataset.active = 'true';
        window.setTimeout(() => {
          if (drawn.current.get(el.controlId) === latest.timeMs) node.dataset.active = 'false';
        }, 160);
      } else if (el.shape === 'joystick') {
        const cap = node.querySelector<SVGCircleElement>('[data-cap]');
        const x = activity.get('joystick.x')?.value ?? 0.5;
        const y = activity.get('joystick.y')?.value ?? 0;
        const r = px(el).w * 0.18;
        cap?.setAttribute('transform', `translate(${(x - 0.5) * 2 * r} ${-y * r})`);
      } else {
        node.dataset.active = latest.value > 0 ? 'true' : 'false';
        if (el.shape === 'pad') node.dataset.bank = latest.id.includes('.B') ? 'B' : 'A';
      }
    }
    const events = session.midi.recentEvents();
    const last = events[events.length - 1];
    if (last && last.seq !== oledSeq.current && oledRef.current) {
      oledSeq.current = last.seq;
      oledRef.current.textContent =
        last.text.length > 26 ? `${last.text.slice(0, 25)}…` : last.text;
    }
  });

  const register = (id: string) => (node: SVGGElement | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full max-h-full w-full max-w-full"
      role="group"
      aria-label="AKAI Professional MPK Mini MK3 (illustration). Select a control to inspect or map it."
      data-testid="mpk-hardware-view"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="mpk-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#23262d" />
          <stop offset="1" stopColor="#15171b" />
        </linearGradient>
        <radialGradient id="mpk-knob" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#3a3e47" />
          <stop offset="1" stopColor="#1b1d22" />
        </radialGradient>
        <filter id="mpk-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect
        x={4}
        y={4}
        width={W - 8}
        height={H - 8}
        rx={26}
        fill="url(#mpk-body)"
        stroke="#33363f"
        strokeWidth={2}
      />
      <rect x={W * 0.03} y={H * 0.515} width={W * 0.94} height={H * 0.47} rx={8} fill="#0f1013" />
      {MPK_MINI_MK3_PANEL_LEGENDS.map((legend) => (
        <text
          key={legend.id}
          x={legend.rect.x * W}
          y={legend.rect.y * H}
          fontSize={11}
          fill="#8f95a1"
          letterSpacing={1.5}
          fontWeight={600}
        >
          {legend.text}
        </text>
      ))}
      {MPK_MINI_MK3_LAYOUT.elements.map((el) => {
        const r = px(el);
        const selected = selectedLayoutId === el.controlId;
        const common = {
          ref: register(el.controlId),
          tabIndex: el.shape === 'display' ? -1 : 0,
          // The display is a picture, not a control: role img, no pressed state.
          role: el.shape === 'display' ? 'img' : 'button',
          'aria-label': labelFor(el),
          'aria-pressed': el.shape === 'display' ? undefined : selected,
          className: 'mpk-control cursor-pointer outline-none',
          'data-control': el.controlId,
          'data-active': 'false',
          onClick: () => el.shape !== 'display' && onSelect(el.controlId),
          onKeyDown: (e: React.KeyboardEvent) => {
            if ((e.key === 'Enter' || e.key === ' ') && el.shape !== 'display') {
              e.preventDefault();
              onSelect(el.controlId);
            }
          },
        } as const;
        const ring = selected ? (
          <rect
            x={r.x - 4}
            y={r.y - 4}
            width={r.w + 8}
            height={r.h + 8}
            rx={8}
            fill="none"
            stroke={colors.accent}
            strokeWidth={3}
          />
        ) : null;
        switch (el.shape) {
          case 'display':
            return (
              <g key={el.controlId} {...common}>
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  rx={4}
                  fill="#05070a"
                  stroke="#2a2d34"
                />
                <text
                  ref={oledRef}
                  x={r.x + 8}
                  y={r.y + r.h / 2 + 4}
                  fontSize={10}
                  fill="#d7e7ff"
                  fontFamily="ui-monospace, monospace"
                >
                  Studio · ready
                </text>
              </g>
            );
          case 'joystick':
            return (
              <g key={el.controlId} {...common}>
                {ring}
                <circle
                  cx={r.x + r.w / 2}
                  cy={r.y + r.h / 2}
                  r={r.w / 2}
                  fill="#0d0e11"
                  stroke="#30333b"
                  strokeWidth={2}
                />
                <g transform={`translate(${r.x + r.w / 2} ${r.y + r.h / 2})`}>
                  <circle data-cap r={r.w * 0.26} fill="url(#mpk-knob)" stroke="#4a4e58" />
                </g>
              </g>
            );
          case 'knob':
            return (
              <g
                key={el.controlId}
                {...common}
                className="mpk-control mpk-knob cursor-pointer outline-none"
              >
                {ring}
                <circle
                  cx={r.x + r.w / 2}
                  cy={r.y + r.h / 2}
                  r={r.w / 2}
                  fill="url(#mpk-knob)"
                  stroke="#4a4e58"
                  strokeWidth={2}
                />
                <g transform={`translate(${r.x + r.w / 2} ${r.y + r.h / 2})`}>
                  <line
                    data-indicator
                    x1={0}
                    y1={-r.w * 0.12}
                    x2={0}
                    y2={-r.w * 0.44}
                    stroke="#f2f3f5"
                    strokeWidth={3}
                    strokeLinecap="round"
                    transform="rotate(-135)"
                  />
                </g>
                <text
                  x={r.x + r.w / 2}
                  y={r.y + r.h + 14}
                  fontSize={11}
                  fill="#c9cdd5"
                  textAnchor="middle"
                  fontWeight={600}
                >
                  {el.legend}
                </text>
              </g>
            );
          case 'pad':
            return (
              <g
                key={el.controlId}
                {...common}
                className="mpk-control mpk-pad cursor-pointer outline-none"
                data-bank={padBank}
              >
                {ring}
                <rect
                  className="mpk-pad-face"
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  rx={6}
                  fill="#24262c"
                  stroke="#3a3d45"
                />
                <rect
                  className="mpk-pad-light"
                  x={r.x + 3}
                  y={r.y + 3}
                  width={r.w - 6}
                  height={r.h - 6}
                  rx={5}
                  fill={PAD_COLORS[padBank]}
                  opacity={0.12}
                />
                <text x={r.x + 6} y={r.y + r.h - 6} fontSize={9} fill="#8f95a1">
                  {el.legend}
                </text>
              </g>
            );
          case 'button':
            return (
              <g
                key={el.controlId}
                {...common}
                className="mpk-control mpk-button cursor-pointer outline-none"
              >
                {ring}
                <rect
                  className="mpk-button-face"
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h * 0.6}
                  rx={4}
                  fill="#2b2e35"
                  stroke="#41444d"
                />
                <text
                  x={r.x + r.w / 2}
                  y={r.y + r.h * 0.6 + 11}
                  fontSize={7.5}
                  fill="#9aa0ab"
                  textAnchor="middle"
                  fontWeight={600}
                  letterSpacing={0.5}
                >
                  {el.legend}
                </text>
              </g>
            );
          case 'key-white':
            return (
              <g
                key={el.controlId}
                {...common}
                className="mpk-control mpk-key-white cursor-pointer outline-none"
              >
                <rect
                  className="mpk-key-face"
                  x={r.x + 1}
                  y={r.y}
                  width={r.w - 2}
                  height={r.h}
                  rx={3}
                  fill="#e7e8ec"
                  stroke="#9ca0a9"
                />
                {selected && (
                  <rect
                    x={r.x + 1}
                    y={r.y}
                    width={r.w - 2}
                    height={r.h}
                    rx={3}
                    fill="none"
                    stroke={colors.accent}
                    strokeWidth={3}
                  />
                )}
                {el.secondaryLegend && (
                  <text
                    x={r.x + r.w / 2}
                    y={r.y + r.h - 8}
                    fontSize={6.5}
                    fill="#5d626d"
                    textAnchor="middle"
                  >
                    {el.secondaryLegend}
                  </text>
                )}
              </g>
            );
          case 'key-black':
            return (
              <g
                key={el.controlId}
                {...common}
                className="mpk-control mpk-key-black cursor-pointer outline-none"
              >
                <rect
                  className="mpk-key-face"
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  rx={2}
                  fill="#17191d"
                  stroke="#000"
                />
                {selected && (
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    rx={2}
                    fill="none"
                    stroke={colors.accent}
                    strokeWidth={3}
                  />
                )}
              </g>
            );
        }
      })}
    </svg>
  );
}
