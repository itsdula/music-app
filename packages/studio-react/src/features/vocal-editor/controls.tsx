/**
 * Vocal editor controls: labelled sliders, the key picker and the Advanced inspector
 * (global correction details + per-note controls for the selection).
 */
import {
  SCALES,
  keyLabel,
  midiToNoteName,
  pitchClassName,
  type AssetId,
  type MusicalKey,
  type PitchClass,
  type ScaleId,
  type VocalCorrectionSettings,
  type VocalEditDoc,
  type VocalNoteEdit,
  type VocalNoteId,
} from '@studio/domain';
import { Button, Select, Slider, Switch, cn } from '@studio/ui';
import type { VocalProcessorCapabilities } from '@studio/vocal-dsp';
import { useRef, type ReactNode } from 'react';
import { useSession } from '../../session/context';
import type { VocalActions } from './actions';
import {
  ALL_KEYS_HEADER,
  centsFromNearest,
  decodeKeyValue,
  displayTargetMidi,
  formatCents,
  formatSemitones,
  hasManualTarget,
  keyOptions,
  noteEditOf,
  pitchLabel,
} from './model';

const percent = (v: number) => `${Math.round(v * 100)}%`;

export function LabeledSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  onChangeEnd,
  disabled,
  hint,
  className,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  onChangeEnd?: () => void;
  disabled?: boolean;
  hint?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)} data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2 text-[10px] font-medium tracking-wide text-text-muted uppercase">
        <span>{label}</span>
        <span className="text-text tabular-nums normal-case">{format(value)}</span>
      </div>
      <Slider
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        formatValue={format}
        onChange={onChange}
        onChangeEnd={() => onChangeEnd?.()}
        {...(disabled !== undefined ? { disabled } : {})}
      />
      {hint ? <p className="text-[10px] leading-snug text-text-faint">{hint}</p> : null}
    </div>
  );
}

/** Commits correction changes as one undo entry per slider gesture. */
export function useCorrectionSetter(assetId: AssetId) {
  const session = useSession();
  const gesture = useRef(0);
  const set = (correction: Partial<VocalCorrectionSettings>, label: string): void => {
    session.history.execute(
      { type: 'vocal.setCorrection', assetId, correction },
      { label, coalesceKey: `vocal-correction:${assetId}:${label}:${gesture.current}` },
    );
  };
  const end = (): void => {
    gesture.current += 1;
  };
  return { set, end };
}

export function KeyPicker({ doc }: { doc: VocalEditDoc }) {
  const session = useSession();
  const { options, value } = keyOptions(doc.keyCandidates, doc.correction.key);
  return (
    <div className="flex flex-col gap-0.5" data-testid="vocal-key">
      <span className="text-[10px] font-medium tracking-wide text-text-muted uppercase">
        Key / scale
      </span>
      <Select
        label="Key and scale"
        size="sm"
        className="w-40"
        value={value}
        options={options.map((o) => ({
          value: o.value,
          label:
            o.value === ALL_KEYS_HEADER ? (
              <span className="text-[10px] text-text-faint uppercase">{o.label}</span>
            ) : (
              o.label
            ),
          textValue: o.label,
          ...(o.disabled ? { disabled: true } : {}),
        }))}
        onValueChange={(v) =>
          session.history.execute(
            {
              type: 'vocal.setCorrection',
              assetId: doc.assetId,
              correction: { key: decodeKeyValue(v) },
            },
            { label: 'Set Vocal Key' },
          )
        }
      />
    </div>
  );
}

const SCALE_OPTIONS = (Object.keys(SCALES) as ScaleId[]).map((id) => ({
  value: id as string,
  label: SCALES[id].label,
}));
const TONIC_OPTIONS = Array.from({ length: 12 }, (_, pc) => ({
  value: String(pc),
  label: pitchClassName(pc as PitchClass),
}));

function ManualKey({ doc }: { doc: VocalEditDoc }) {
  const session = useSession();
  const key = doc.correction.key;
  const setKey = (next: MusicalKey | null) =>
    session.history.execute(
      { type: 'vocal.setCorrection', assetId: doc.assetId, correction: { key: next } },
      { label: 'Set Vocal Key' },
    );
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-wide text-text-muted uppercase">
        Any scale
      </span>
      <div className="flex gap-1.5">
        <Select
          label="Tonic"
          size="sm"
          className="w-16"
          value={key ? String(key.tonic) : ''}
          placeholder="Tonic"
          options={TONIC_OPTIONS}
          onValueChange={(v) =>
            setKey({ tonic: Number(v) as PitchClass, scale: key?.scale ?? 'major' })
          }
        />
        <Select
          label="Scale"
          size="sm"
          className="min-w-0 flex-1"
          value={key?.scale ?? ''}
          placeholder="Scale"
          options={SCALE_OPTIONS}
          onValueChange={(v) => {
            if (v in SCALES) setKey({ tonic: key?.tonic ?? 0, scale: v as ScaleId });
          }}
        />
      </div>
      <p className="text-[10px] text-text-faint">
        {key ? `Notes snap to ${keyLabel(key)}.` : 'Chromatic: notes snap to the nearest semitone.'}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-b border-line px-3 py-2.5 last:border-b-0">
      <h3 className="text-[11px] font-semibold text-text">{title}</h3>
      {children}
    </section>
  );
}

/** Advanced inspector: correction details and per-note controls for the selection. */
export function VocalInspector({
  doc,
  selected,
  actions,
  capabilities,
}: {
  doc: VocalEditDoc;
  selected: ReadonlySet<VocalNoteId>;
  actions: VocalActions;
  capabilities: VocalProcessorCapabilities;
}) {
  const correction = useCorrectionSetter(doc.assetId);
  const noteGesture = useRef(0);
  const c = doc.correction;
  const chosen = doc.segments.filter((s) => selected.has(s.id));
  const first = chosen[0];
  const edit: VocalNoteEdit | null = first ? noteEditOf(doc, first.id) : null;
  const patch = (p: Partial<VocalNoteEdit>, label: string) =>
    actions.patchSelected(p, label, `vocal-note:${doc.assetId}:${label}:${noteGesture.current}`);
  const endNoteGesture = () => {
    noteGesture.current += 1;
  };

  return (
    <aside
      className="vocal-inspector flex w-64 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface-1"
      aria-label="Advanced vocal settings"
      data-testid="vocal-inspector"
    >
      <Section title="Correction">
        <LabeledSlider
          label="Retune speed"
          value={c.retuneSpeedMs}
          min={0}
          max={400}
          step={5}
          format={(v) => `${Math.round(v)} ms`}
          onChange={(v) => correction.set({ retuneSpeedMs: v }, 'Retune Speed')}
          onChangeEnd={correction.end}
          hint="Time to reach the target at note starts. Short times sound more robotic."
        />
        <div className="flex flex-col gap-1">
          <Switch
            label="Preserve formants"
            checked={capabilities.formantPreservation ? c.formantPreservation : false}
            disabled={!capabilities.formantPreservation}
            onCheckedChange={(on) =>
              correction.set({ formantPreservation: on }, 'Formant Preservation')
            }
          />
          <p className="text-[10px] leading-snug text-text-faint">
            {capabilities.formantPreservation
              ? `Built into ${capabilities.algorithm.toUpperCase()}: pitch is moved without resampling, so the voice keeps its character. Turn off for a deliberate “chipmunk” effect.`
              : 'Not available with the current processing engine.'}
          </p>
        </div>
        <LabeledSlider
          label="Formant shift"
          value={capabilities.formantShift ? c.formantShiftSemitones : 0}
          min={-12}
          max={12}
          step={0.5}
          format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} st`}
          disabled={!capabilities.formantShift}
          onChange={(v) => correction.set({ formantShiftSemitones: v }, 'Formant Shift')}
          onChangeEnd={correction.end}
          hint={
            capabilities.formantShift
              ? 'Darker (−) or brighter (+) timbre without changing pitch.'
              : 'Not supported by the current processing engine.'
          }
        />
        <ManualKey doc={doc} />
      </Section>
      <Section title={chosen.length > 1 ? `${chosen.length} selected notes` : 'Selected note'}>
        {!first || !edit ? (
          <p className="text-[11px] text-text-faint">
            Select a note in the editor (or the notes list) to adjust it.
          </p>
        ) : (
          <>
            <div
              className="flex items-center justify-between gap-2 text-[11px]"
              data-testid="vocal-note-target"
            >
              <div className="flex flex-col">
                <span className="text-text-muted">
                  Sung {midiToNoteName(first.detectedMidi)}{' '}
                  {formatCents(centsFromNearest(first.detectedMidi))}
                </span>
                <span className="font-medium text-text tabular-nums">
                  Target {pitchLabel(displayTargetMidi(first, doc))}
                  {' · '}
                  {formatSemitones(displayTargetMidi(first, doc) - first.detectedMidi)}
                </span>
                <span className="text-[10px] text-text-faint">
                  {hasManualTarget(edit) ? 'Manual target' : 'Automatic target'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="Raise one semitone"
                  onClick={() => actions.nudge(1, false)}
                >
                  +1 st
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="Lower one semitone"
                  onClick={() => actions.nudge(-1, false)}
                >
                  −1 st
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="Raise 10 cents"
                  onClick={() => actions.nudge(1, true)}
                >
                  +10¢
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="Lower 10 cents"
                  onClick={() => actions.nudge(-1, true)}
                >
                  −10¢
                </Button>
              </div>
            </div>
            <LabeledSlider
              label="Drift correction"
              value={edit.driftCorrection}
              min={0}
              max={1}
              step={0.01}
              format={percent}
              onChange={(v) => patch({ driftCorrection: v }, 'Drift Correction')}
              onChangeEnd={endNoteGesture}
              hint={`Removes slow pitch drift across the note (detected ${formatCents(Math.round(first.driftCents))}).`}
            />
            <LabeledSlider
              label="Vibrato / modulation"
              value={edit.modulationScale}
              min={0}
              max={2}
              step={0.01}
              format={percent}
              onChange={(v) => patch({ modulationScale: v }, 'Vibrato Scale')}
              onChangeEnd={endNoteGesture}
              hint={
                first.vibratoDepthCents > 0
                  ? `Detected vibrato ±${Math.round(first.vibratoDepthCents)}¢ at ${first.vibratoRateHz.toFixed(1)} Hz. 0% flattens, 200% exaggerates.`
                  : '0% flattens wobble, 200% exaggerates it.'
              }
            />
            <LabeledSlider
              label="Transition"
              value={edit.transitionMs}
              min={0}
              max={300}
              step={5}
              format={(v) => `${Math.round(v)} ms`}
              onChange={(v) => patch({ transitionMs: v }, 'Note Transition')}
              onChangeEnd={endNoteGesture}
              hint="Glide time into this note from the previous one."
            />
            <Switch
              label="Bypass (leave untouched)"
              checked={edit.bypass}
              onCheckedChange={(on) => patch({ bypass: on }, on ? 'Bypass Note' : 'Unbypass Note')}
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                disabled={!chosen.some((s) => hasManualTarget(noteEditOf(doc, s.id)))}
                onClick={() => actions.clearTargets(chosen.map((s) => s.id))}
              >
                Auto target
              </Button>
              <Button size="sm" variant="ghost" onClick={() => actions.resetSelected()}>
                Reset note{chosen.length > 1 ? 's' : ''}
              </Button>
            </div>
          </>
        )}
      </Section>
    </aside>
  );
}
