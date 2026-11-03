import { MPK_MINI_MK3_LAYOUT, controlIdsForLayoutElement } from '@studio/midi-akai-mpk-mini-mk3';
import { Suspense, useRef, useState } from 'react';
import { SegmentedControl, Spinner } from '@studio/ui';
import { useFrame } from '../../lib/use-frame';
import { useSession } from '../../session/context';
import { LazyMpk3DView, MPK_3D_ENABLED } from './mpk-3d'; // mpk-3d experiment
import { MPK_PANEL_WIDTH, MpkMiniPanel } from './mpk-panel/MpkMiniPanel';

/**
 * The controller panel's picture of the AKAI Professional MPK Mini MK3 (see `MpkMiniPanel`).
 * Live MIDI activity is drawn from the render loop by mutating SVG attributes directly, so
 * incoming messages never re-render React.
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
  const [mode, setMode] = useState<'2d' | '3d'>('2d'); // mpk-3d experiment

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
        const r = el.rect.w * MPK_PANEL_WIDTH * 0.14;
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

  const register = (id: string, node: SVGGElement | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  };

  const panel = (
    <MpkMiniPanel
      label="AKAI Professional MPK Mini MK3 (illustration). Select a control to inspect or map it."
      className="h-full max-h-full w-full max-w-full drop-shadow-[0_18px_30px_rgba(0,0,0,0.45)]"
      testId="mpk-hardware-view"
      selectedId={selectedLayoutId}
      onSelect={onSelect}
      padBank={padBank}
      registerNode={register}
      oledRef={oledRef}
    />
  );

  // mpk-3d experiment: start (remove this block and return `panel` to drop the 3D view)
  if (!MPK_3D_ENABLED) return panel;
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {mode === '3d' ? (
        <Suspense fallback={<Spinner label="Loading 3D view" />}>
          <LazyMpk3DView className="h-full w-full" />
        </Suspense>
      ) : (
        panel
      )}
      <div className="absolute top-0 right-0">
        <SegmentedControl
          label="Controller drawing"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: '2d', label: '2D' },
            { value: '3d', label: '3D' },
          ]}
        />
      </div>
    </div>
  );
  // mpk-3d experiment: end
}
