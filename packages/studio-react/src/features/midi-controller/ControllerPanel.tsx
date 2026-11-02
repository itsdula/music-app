import { MPK_MINI_MK3_CAPABILITIES, MPK_MINI_MK3_PROFILE_ID } from '@studio/midi-akai-mpk-mini-mk3';
import { Badge, Button, Select, SegmentedControl } from '@studio/ui';
import { useState } from 'react';
import { useStore } from 'zustand';
import { useSession } from '../../session/context';
import { ControlInspector } from './ControlInspector';
import { DiagnosticsLog } from './DiagnosticsLog';
import { HardwareView } from './HardwareView';
import { MappingsTable } from './MappingsTable';

type View = 'hardware' | 'mappings' | 'diagnostics' | 'compatibility';

const SUPPORT_TONE = {
  supported: 'success',
  'software-equivalent': 'accent',
  experimental: 'warning',
  unsupported: 'neutral',
} as const;

export function ControllerPanel() {
  const session = useSession();
  const status = useStore(session.midi.store, (s) => s.status);
  const devices = useStore(session.midi.store, (s) => s.devices);
  const velocityCurve = useStore(session.midi.store, (s) => s.velocityCurve);
  const recordQuantize = useStore(session.midi.store, (s) => s.recordQuantize);
  const lastError = useStore(session.midi.store, (s) => s.lastError);
  const [view, setView] = useState<View>('hardware');
  const [selected, setSelected] = useState<string | null>('knob.K1');
  const [bank, setBank] = useState<'A' | 'B'>('A');
  const mpk = devices.find(
    (d) => d.type === 'input' && d.profileId === MPK_MINI_MK3_PROFILE_ID && d.state === 'connected',
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="controller-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px]">
        <span className="font-semibold">AKAI Professional MPK Mini MK3</span>
        {mpk ? (
          <Badge tone="success">Connected · {mpk.displayName}</Badge>
        ) : (
          <Badge tone="neutral">
            {status === 'unsupported' ? 'Web MIDI unavailable' : 'Not connected'}
          </Badge>
        )}
        {status !== 'granted' && status !== 'unsupported' && (
          <Button size="sm" variant="secondary" onClick={() => void session.midi.requestAccess()}>
            Connect MIDI
          </Button>
        )}
        <div className="flex-1" />
        <Select
          label="Velocity curve"
          size="sm"
          value={velocityCurve}
          onValueChange={(v: string) =>
            void session.midi.updateSettings({ velocityCurve: v as typeof velocityCurve })
          }
          options={[
            { value: 'linear', label: 'Velocity: linear' },
            { value: 'soft', label: 'Velocity: soft' },
            { value: 'hard', label: 'Velocity: hard' },
            { value: 'fixed', label: 'Velocity: fixed' },
          ]}
        />
        <Select
          label="Quantize MIDI recording"
          size="sm"
          value={recordQuantize ?? 'off'}
          onValueChange={(v: string) =>
            void session.midi.updateSettings({ recordQuantize: v === 'off' ? null : (v as '1/16') })
          }
          options={[
            { value: 'off', label: 'Record: no quantize' },
            { value: '1/8', label: 'Record: quantize 1/8' },
            { value: '1/16', label: 'Record: quantize 1/16' },
            { value: '1/32', label: 'Record: quantize 1/32' },
            { value: '1/8T', label: 'Record: quantize 1/8 T' },
            { value: '1/16T', label: 'Record: quantize 1/16 T' },
          ]}
        />
        <SegmentedControl
          label="Controller view"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'hardware', label: 'Hardware' },
            { value: 'mappings', label: 'Mappings' },
            { value: 'diagnostics', label: 'Diagnostics' },
            { value: 'compatibility', label: 'Compatibility' },
          ]}
        />
      </div>
      {lastError && (
        <p className="border-b border-warning/30 bg-warning/10 px-3 py-1 text-[11px]">
          {lastError}
        </p>
      )}
      {view === 'hardware' && (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 items-center justify-center p-3">
            <HardwareView selectedLayoutId={selected} onSelect={setSelected} padBank={bank} />
          </div>
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-line bg-surface-2/40">
            {selected ? (
              <ControlInspector layoutId={selected} bank={bank} onBankChange={setBank} />
            ) : (
              <p className="p-3 text-[12px] text-text-muted">Select a control on the device.</p>
            )}
          </aside>
        </div>
      )}
      {view === 'mappings' && <MappingsTable />}
      {view === 'diagnostics' && <DiagnosticsLog />}
      {view === 'compatibility' && (
        <div
          className="min-h-0 flex-1 overflow-auto p-3 text-[12px]"
          data-testid="mpk-compatibility"
          tabIndex={0}
          role="region"
          aria-label="Compatibility matrix"
        >
          <p className="mb-2 text-text-muted">
            What Nawa does with this controller and how well each item is evidenced. Nothing below
            has been tested on a physical unit yet; see docs/midi-integration.md for the hardware
            test protocol.
          </p>
          <table className="w-full text-left">
            <thead className="text-[10px] tracking-wide text-text-faint uppercase">
              <tr>
                <th className="py-1">Capability</th>
                <th className="py-1">Nawa</th>
                <th className="py-1">Evidence</th>
                <th className="py-1">Notes</th>
              </tr>
            </thead>
            <tbody>
              {MPK_MINI_MK3_CAPABILITIES.map((c) => (
                <tr key={c.id} className="border-t border-line/60 align-top">
                  <td className="py-1 pr-2 font-medium">{c.label}</td>
                  <td className="py-1 pr-2">
                    <Badge tone={SUPPORT_TONE[c.support]}>{c.support.replace('-', ' ')}</Badge>
                  </td>
                  <td className="py-1 pr-2 text-text-muted">{c.verification}</td>
                  <td className="py-1 text-text-faint">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
