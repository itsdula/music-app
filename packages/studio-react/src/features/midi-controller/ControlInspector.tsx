import {
  DEFAULT_VALUE_TRANSFORM,
  createMidiMapping,
  type MappingCurve,
  type MidiMapping,
} from '@studio/domain';
import {
  MPK_MINI_MK3_CONTROLS,
  MPK_MINI_MK3_PROFILE_ID,
  controlIdsForLayoutElement,
} from '@studio/midi-akai-mpk-mini-mk3';
import type { DeviceControl } from '@studio/midi-core';
import { Badge, Button, Select, SegmentedControl, Slider, Switch } from '@studio/ui';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useProjectState, useSession, useUiState } from '../../session/context';
import {
  describeSource,
  describeTarget,
  mappingsForControl,
  targetKey,
  targetOptions,
} from './mapping-helpers';

const VERIFICATION_TONE = {
  documented: 'success',
  community: 'warning',
  unverified: 'neutral',
  'verified-hardware': 'success',
} as const;
const VERIFICATION_LABEL = {
  documented: 'Documented',
  community: 'Community-reported',
  unverified: 'Unverified',
  'verified-hardware': 'Verified on hardware',
} as const;

function controlFor(layoutId: string, bank: 'A' | 'B'): DeviceControl | undefined {
  const ids = controlIdsForLayoutElement(layoutId);
  const id = ids.find((x) => x.endsWith(`${bank}${layoutId.split('.')[1] ?? ''}`)) ?? ids[0];
  return MPK_MINI_MK3_CONTROLS.find((c) => c.id === id);
}

export function ControlInspector({
  layoutId,
  bank,
  onBankChange,
}: {
  layoutId: string;
  bank: 'A' | 'B';
  onBankChange: (b: 'A' | 'B') => void;
}) {
  const session = useSession();
  const project = useProjectState((s) => s.project);
  const selectedTrackId = useUiState((s) => s.selection.trackId);
  const globalMappings = useStore(session.midi.store, (s) => s.globalMappings);
  const ids = controlIdsForLayoutElement(layoutId);
  const control = controlFor(layoutId, bank);
  const options = useMemo(() => targetOptions(project), [project]);
  const all = useMemo(
    () => [...globalMappings, ...project.midiMappings],
    [globalMappings, project.midiMappings],
  );

  if (!control) {
    return <p className="p-3 text-[12px] text-text-muted">This element does not send MIDI.</p>;
  }
  const mappings = mappingsForControl(all, control, MPK_MINI_MK3_PROFILE_ID);
  const mapping = mappings[0];
  const isGlobal = mapping?.scope === 'global';

  const save = async (next: MidiMapping) => {
    if (next.scope === 'global') {
      await session.midi.setGlobalMappings(
        globalMappings.some((m) => m.id === next.id)
          ? globalMappings.map((m) => (m.id === next.id ? next : m))
          : [...globalMappings, next],
      );
    } else if (project.midiMappings.some((m) => m.id === next.id)) {
      const { id, scope: _scope, ...patch } = next;
      session.history.execute(
        { type: 'mapping.update', mappingId: id, patch },
        { label: 'Edit MIDI Mapping' },
      );
    } else {
      session.history.execute(
        { type: 'mapping.add', mapping: next },
        { label: 'Add MIDI Mapping' },
      );
    }
  };

  const remove = async () => {
    if (!mapping) return;
    if (mapping.scope === 'global')
      await session.midi.setGlobalMappings(globalMappings.filter((m) => m.id !== mapping.id));
    else
      session.history.execute(
        { type: 'mapping.remove', mappingIds: [mapping.id] },
        { label: 'Remove MIDI Mapping' },
      );
  };

  const assign = (key: string) => {
    const option = options.find((o) => o.key === key);
    if (!option || !control.defaultSource) return;
    if (mapping) {
      void save({ ...mapping, target: option.target, label: `${control.label} → ${option.label}` });
    } else {
      void save(
        createMidiMapping({
          id: session.edits.newMappingId(),
          source: control.defaultSource,
          device: { profileId: MPK_MINI_MK3_PROFILE_ID },
          target: option.target,
          scope: 'project',
          transform: control.kind === 'knob' ? { takeover: 'pickup' } : {},
          label: `${control.label} → ${option.label}`,
        }),
      );
    }
  };

  const transform = mapping?.transform ?? DEFAULT_VALUE_TRANSFORM;

  return (
    <div className="flex min-w-0 flex-col gap-3 p-3 text-[12px]" data-testid="control-inspector">
      <header className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">{control.label}</h3>
        <Badge tone={VERIFICATION_TONE[control.verification]}>
          {VERIFICATION_LABEL[control.verification]}
        </Badge>
      </header>
      {ids.length > 1 && layoutId.startsWith('pad.') && (
        <SegmentedControl
          label="Pad bank"
          size="sm"
          value={bank}
          onChange={onBankChange}
          options={[
            { value: 'A', label: 'Bank A' },
            { value: 'B', label: 'Bank B' },
          ]}
        />
      )}
      <dl className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 text-text-muted">
        <dt>Sends (default)</dt>
        <dd className="text-text">
          {control.defaultSource
            ? describeSource(control.defaultSource)
            : 'Nothing (handled on the device)'}
        </dd>
      </dl>
      {control.note && (
        <p className="text-[11px] leading-relaxed text-text-faint">{control.note}</p>
      )}

      <section
        className="flex flex-col gap-2 rounded-md border border-line bg-surface-1 p-2"
        aria-label="Studio mapping (software)"
      >
        <h4 className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
          Studio mapping · software
        </h4>
        {control.defaultSource ? (
          <>
            <Select
              label="Mapped to"
              size="sm"
              value={mapping ? targetKey(mapping.target) : undefined}
              placeholder={
                control.kind === 'key' || control.kind === 'pad'
                  ? 'Plays notes on the selected instrument'
                  : 'Not mapped'
              }
              onValueChange={assign}
              options={options.map((o) => ({
                value: o.key,
                label: `${o.group} · ${o.label}`,
                textValue: o.label,
              }))}
            />
            {mapping && (
              <>
                <p className="text-text-muted">
                  {describeTarget(project, mapping.target, selectedTrackId)} ·{' '}
                  {isGlobal ? 'global (all projects)' : 'this project'}
                </p>
                {mapping.source.kind === 'cc' && (
                  <div className="grid grid-cols-[88px_1fr] items-center gap-2">
                    <span className="text-text-muted">Minimum</span>
                    <Slider
                      label="Mapping minimum"
                      min={0}
                      max={1}
                      step={0.01}
                      value={transform.min}
                      formatValue={(v) => `${Math.round(v * 100)}%`}
                      onChange={(min) =>
                        void save({ ...mapping, transform: { ...transform, min } })
                      }
                    />
                    <span className="text-text-muted">Maximum</span>
                    <Slider
                      label="Mapping maximum"
                      min={0}
                      max={1}
                      step={0.01}
                      value={transform.max}
                      formatValue={(v) => `${Math.round(v * 100)}%`}
                      onChange={(max) =>
                        void save({ ...mapping, transform: { ...transform, max } })
                      }
                    />
                    <span className="text-text-muted">Curve</span>
                    <Select
                      label="Curve"
                      size="sm"
                      value={transform.curve}
                      onValueChange={(curve: string) =>
                        void save({
                          ...mapping,
                          transform: { ...transform, curve: curve as MappingCurve },
                        })
                      }
                      options={[
                        { value: 'linear', label: 'Linear' },
                        { value: 'exponential', label: 'Exponential' },
                        { value: 'logarithmic', label: 'Logarithmic' },
                        { value: 'sCurve', label: 'S-curve' },
                      ]}
                    />
                    <span className="text-text-muted">Invert</span>
                    <Switch
                      label="Invert"
                      checked={transform.invert}
                      onCheckedChange={(invert) =>
                        void save({ ...mapping, transform: { ...transform, invert } })
                      }
                    />
                    <span className="text-text-muted">Pickup</span>
                    <Switch
                      label="Soft takeover (pickup)"
                      checked={transform.takeover === 'pickup'}
                      onCheckedChange={(on) =>
                        void save({
                          ...mapping,
                          transform: { ...transform, takeover: on ? 'pickup' : 'immediate' },
                        })
                      }
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => mapping && session.midi.startLearn(mapping.target)}
                  >
                    Re-learn
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void remove()}>
                    Remove mapping
                  </Button>
                </div>
              </>
            )}
          </>
        ) : (
          <p className="text-text-faint">
            This control is handled inside the controller and sends no MIDI Studio can map.
          </p>
        )}
      </section>

      <section
        className="rounded-md border border-dashed border-line p-2 text-[11px] text-text-muted"
        aria-label="Hardware settings"
      >
        <h4 className="mb-1 font-semibold tracking-wide uppercase">Hardware setting · read-only</h4>
        Studio does not write to the controller’s internal programs: AKAI publishes no
        program-editing protocol for the MPK Mini MK3, so channels, CC numbers and pad notes can
        only be changed with AKAI’s own editor. Use Studio mappings above as the software
        equivalent.
      </section>
    </div>
  );
}
