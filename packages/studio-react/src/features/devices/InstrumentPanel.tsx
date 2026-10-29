import { INSTRUMENT_LABELS, INSTRUMENT_PARAM_SPECS, SYNTH_PRESETS, createInstrumentConfig, type Track } from '@studio/domain';
import { Select } from '@studio/ui';
import { useProjectState, useSession } from '../../session/context';
import { ParamControl } from './ParamControl';

const SYNTH_GROUPS: ReadonlyArray<{ title: string; ids: readonly string[] }> = [
  { title: 'Oscillators', ids: ['osc1Waveform', 'osc2Waveform', 'osc2Mix', 'osc2Detune', 'osc2Octave'] },
  { title: 'Amp envelope', ids: ['attack', 'decay', 'sustain', 'release'] },
  { title: 'Filter', ids: ['cutoffHz', 'resonance', 'filterEnvAmount', 'filterDecay'] },
  { title: 'Voice', ids: ['polyphony', 'glideMs', 'gainDb'] },
];

export function InstrumentPanel({ track }: { track: Track }) {
  const session = useSession();
  const assets = useProjectState((s) => s.project.assets);
  const instrument = track.instrument;
  if (!instrument) return null;
  const specs = INSTRUMENT_PARAM_SPECS[instrument.kind];
  const groups = instrument.kind === 'synth' ? SYNTH_GROUPS : [{ title: INSTRUMENT_LABELS[instrument.kind], ids: specs.map((s) => s.id) }];
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3" aria-label={`${INSTRUMENT_LABELS[instrument.kind]} settings`} data-testid="instrument-panel">
      <header className="flex items-center gap-2">
        <h3 className="text-[12px] font-semibold">{INSTRUMENT_LABELS[instrument.kind]}</h3>
        {instrument.kind === 'synth' && (
          <Select
            label="Preset"
            size="sm"
            value={instrument.presetId}
            placeholder="Custom"
            onValueChange={(presetId: string) =>
              session.history.execute({ type: 'track.setInstrument', trackId: track.id, instrument: createInstrumentConfig('synth', presetId) }, { label: 'Load Preset' })
            }
            options={SYNTH_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          />
        )}
        {instrument.kind === 'sampler' && (
          <Select
            label="Sample"
            size="sm"
            value={instrument.sampleAssetId}
            placeholder={Object.keys(assets).length === 0 ? 'Import audio first' : 'Choose a sample'}
            disabled={Object.keys(assets).length === 0}
            onValueChange={(assetId: string) =>
              session.history.execute(
                { type: 'track.setInstrument', trackId: track.id, instrument: { ...instrument, sampleAssetId: assetId as keyof typeof assets } },
                { label: 'Assign Sample' },
              )
            }
            options={Object.values(assets).map((a) => ({ value: a.id, label: a.name }))}
          />
        )}
      </header>
      <div className="flex flex-wrap gap-4">
        {groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold tracking-wide text-text-faint uppercase">{group.title}</span>
            <div className="flex flex-wrap items-end gap-3">
              {group.ids.map((id) => {
                const spec = specs.find((s) => s.id === id);
                if (!spec) return null;
                return (
                  <ParamControl
                    key={id}
                    spec={spec}
                    value={instrument.params[id] ?? spec.default}
                    gestureKey={`inst:${track.id}:${id}`}
                    address={{ scope: 'instrument', trackId: track.id, param: id }}
                    size="sm"
                    command={(v) => ({ type: 'track.setInstrumentParams', trackId: track.id, params: { [id]: v } })}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
