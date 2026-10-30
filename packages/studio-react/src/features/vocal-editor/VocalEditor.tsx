/**
 * Vocal pitch editor for an audio clip: analysis lifecycle (empty → analysing → ready /
 * error), a minimal correction toolbar, the canvas pitch editor, an accessible notes list
 * and an Advanced inspector. All edits go through vocal.* commands (undoable); the
 * VocalController renders the preview that plays through the engine.
 */
import type { AssetRef, AudioClip, VocalEditDoc } from '@studio/domain';
import { ParameterSliderField } from '@studio/audio-ui';
import { Badge, Button, EmptyState, ProgressBar, Spinner, ToggleButton } from '@studio/ui';
import type { VocalAnalysis } from '@studio/vocal-dsp';
import { AlertTriangle, Download, ListMusic, Mic, Pencil, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useProjectState, useSession, useUiState } from '../../session/context';
import type { VocalAssetState } from '../../state/vocal-store';
import { createVocalActions } from './actions';
import { KeyPicker, VocalInspector, useCorrectionSetter } from './controls';
import type { ClipTimeMapping } from './geometry';
import { summarizeSelection } from './model';
import { NotesTable } from './NotesTable';
import { PitchEditor, playheadSourceSeconds } from './PitchEditor';
import {
  NON_PITCHED_COLORS,
  NON_PITCHED_LABELS,
  TARGET_LINE_COLOR,
  VOCAL_NOTE_COLOR,
} from './renderer';
import { useVocalAssetState } from './use-vocal';

export function VocalEditor({ clip }: { clip: AudioClip }) {
  const session = useSession();
  const assetId = clip.assetId;
  const asset = useProjectState((s) => s.project.assets[assetId]);
  const doc = useProjectState((s) => s.project.vocalEdits[assetId]);
  const job = useVocalAssetState(assetId);
  // Typed arrays live in the controller; the store's version tells us when they change.
  const analysis = useMemo(
    () => (job.analysisVersion > 0 ? session.vocal.getAnalysis(assetId) : undefined),
    [session, assetId, job.analysisVersion],
  );

  // A saved edit document without analysis in memory (e.g. after reopening the project):
  // reload the analysis automatically (usually instant from the derived-data cache).
  const autoLoaded = useRef(new Set<string>());
  const needsReload = doc !== undefined && analysis === undefined && job.phase === 'idle';
  useEffect(() => {
    if (!needsReload || autoLoaded.current.has(assetId)) return;
    autoLoaded.current.add(assetId);
    void session.vocal.analyze(assetId);
  }, [needsReload, assetId, session]);

  let body;
  if (!asset) {
    body = (
      <EmptyState
        icon={<AlertTriangle />}
        title="Source audio is missing"
        description="This clip's audio file is not in the project, so it cannot be analyzed."
      />
    );
  } else if (job.phase === 'analyzing') {
    body = (
      <AnalyzingState
        job={job}
        onCancel={() => session.vocal.cancel(assetId)}
        reloading={doc !== undefined}
      />
    );
  } else if (doc && analysis) {
    return <ReadyEditor clip={clip} asset={asset} doc={doc} analysis={analysis} job={job} />;
  } else if (job.phase === 'error') {
    body = (
      <EmptyState
        icon={<AlertTriangle />}
        title="Vocal analysis failed"
        description={job.error ?? 'Something went wrong while analyzing this audio.'}
        action={
          <Button variant="primary" onClick={() => void session.vocal.analyze(assetId)}>
            Try again
          </Button>
        }
        data-testid="vocal-error"
      />
    );
  } else {
    body = (
      <EmptyState
        icon={<Mic />}
        title="Pitch-correct this vocal"
        description="Studio finds the notes of a single-voice (monophonic) vocal so you can tune them. Analysis runs locally on this device; nothing is uploaded."
        action={
          <Button
            variant="primary"
            icon={<Mic />}
            onClick={() => void session.vocal.analyze(assetId)}
          >
            Analyze vocal
          </Button>
        }
      />
    );
  }
  return (
    <div
      className="vocal-editor flex min-h-0 flex-1 items-center justify-center"
      data-testid="vocal-editor"
      data-state={job.phase}
      data-clip-id={clip.id}
    >
      {body}
    </div>
  );
}

function AnalyzingState({
  job,
  onCancel,
  reloading,
}: {
  job: VocalAssetState;
  onCancel: () => void;
  reloading: boolean;
}) {
  const pct = Math.round(job.progress * 100);
  return (
    <div
      className="flex w-72 flex-col items-center gap-3 text-center"
      data-testid="vocal-analyzing"
    >
      <p className="text-[13px] font-medium text-text">
        {reloading ? 'Loading vocal analysis…' : 'Analyzing vocal…'}
      </p>
      <ProgressBar label="Vocal analysis progress" value={job.progress} valueText={`${pct}%`} />
      <p className="text-[11px] text-text-muted tabular-nums">
        {pct}% · detecting pitch, notes and key
      </p>
      <Button size="sm" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function ReadyEditor({
  clip,
  asset,
  doc,
  analysis,
  job,
}: {
  clip: AudioClip;
  asset: AssetRef;
  doc: VocalEditDoc;
  analysis: VocalAnalysis;
  job: VocalAssetState;
}) {
  const session = useSession();
  const bpm = useProjectState((s) => s.project.bpm);
  const selectedRaw = useUiState((s) => s.selection.vocalNoteIds);
  const [editing, setEditing] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const liveId = useId();
  const fittedFor = useRef<string | null>(null);
  const claimAutoFit = useCallback((clipId: string) => {
    if (fittedFor.current === clipId) return false;
    fittedFor.current = clipId;
    return true;
  }, []);
  const correction = useCorrectionSetter(doc.assetId);
  const capabilities = useMemo(() => session.vocal.capabilities, [session]);

  const selected = useMemo(() => {
    const present = new Set(doc.segments.map((s) => s.id));
    return new Set([...selectedRaw].filter((id) => present.has(id)));
  }, [doc.segments, selectedRaw]);
  const chosen = useMemo(
    () => doc.segments.filter((s) => selected.has(s.id)),
    [doc.segments, selected],
  );
  const actions = useMemo(
    () => createVocalActions(session, doc.assetId, analysis),
    [session, doc.assetId, analysis],
  );
  const map = useMemo<ClipTimeMapping>(
    () => ({
      startTick: clip.startTick,
      sourceStartFrame: clip.sourceStartFrame,
      lengthFrames: clip.lengthFrames,
      sampleRate: asset.sampleRate,
      bpm,
    }),
    [clip.startTick, clip.sourceStartFrame, clip.lengthFrames, asset.sampleRate, bpm],
  );
  const splitTimes = () => [playheadSourceSeconds(session, map)];

  const exportWav = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await session.vocal.exportCorrected(doc.assetId);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  const lowConfidence = doc.segments.filter((s) => s.confidence < 0.5).length;

  return (
    <div
      className="vocal-editor flex min-h-0 flex-1 flex-col"
      data-testid="vocal-editor"
      data-state="ready"
      data-clip-id={clip.id}
    >
      <div className="flex shrink-0 flex-wrap items-end gap-x-4 gap-y-2 border-b border-line px-3 py-2">
        <KeyPicker doc={doc} />
        <ParameterSliderField
          className="w-36"
          label="Auto Tune"
          data-testid="vocal-amount"
          value={doc.correction.amount}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => correction.set({ amount: v }, 'Auto Tune Amount')}
          onCommit={correction.end}
        />
        <ParameterSliderField
          className="w-32"
          label="Humanize"
          data-testid="vocal-humanize"
          value={doc.correction.humanize}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => correction.set({ humanize: v }, 'Humanize')}
          onCommit={correction.end}
        />
        <div className="flex items-center gap-1.5">
          <ToggleButton
            size="sm"
            tone="accent"
            pressed={editing}
            onPressedChange={setEditing}
            icon={<Pencil />}
            label="Edit notes: drag notes up or down to retarget them (Alt = no snapping)"
            data-testid="vocal-edit-notes"
          >
            Edit notes
          </ToggleButton>
          <ToggleButton
            size="sm"
            tone="warning"
            pressed={!doc.enabled}
            label={
              doc.enabled
                ? 'B · Corrected: playing the corrected vocal. Click to hear the original.'
                : 'A · Original: playing the original vocal. Click to hear the correction.'
            }
            onPressedChange={(original) =>
              session.history.execute(
                { type: 'vocal.setEnabled', assetId: doc.assetId, enabled: !original },
                { label: original ? 'Play Original Vocal' : 'Play Corrected Vocal' },
              )
            }
            data-testid="vocal-ab"
          >
            {doc.enabled ? 'B · Corrected' : 'A · Original'}
          </ToggleButton>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          {job.rendering ? (
            <Badge tone="accent" data-testid="vocal-rendering" aria-live="polite">
              <Spinner size="sm" aria-hidden /> Rendering preview…
            </Badge>
          ) : null}
          <ToggleButton
            size="sm"
            tone="neutral"
            pressed={listOpen}
            onPressedChange={setListOpen}
            icon={<ListMusic />}
            data-testid="vocal-notes-list-toggle"
          >
            Notes list
          </ToggleButton>
          <ToggleButton
            size="sm"
            tone="neutral"
            pressed={inspectorOpen}
            onPressedChange={setInspectorOpen}
            icon={<SlidersHorizontal />}
            data-testid="vocal-advanced"
          >
            Advanced
          </ToggleButton>
          <Button
            size="sm"
            variant="secondary"
            icon={<Download />}
            disabled={exporting}
            onClick={() => void exportWav()}
          >
            {exporting ? 'Exporting…' : 'Export corrected WAV'}
          </Button>
        </div>
      </div>
      {job.error || exportError ? (
        <p
          role="alert"
          className="shrink-0 border-b border-line bg-record/10 px-3 py-1 text-[11px] text-record"
        >
          {exportError ?? job.error}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1">
        {listOpen ? (
          <NotesTable doc={doc} selected={selected} actions={actions} splitTimes={splitTimes} />
        ) : (
          <PitchEditor
            clip={clip}
            doc={doc}
            analysis={analysis}
            map={map}
            actions={actions}
            editing={editing}
            selected={selected}
            describedBy={liveId}
            claimAutoFit={claimAutoFit}
          />
        )}
        {inspectorOpen ? (
          <VocalInspector
            doc={doc}
            selected={selected}
            actions={actions}
            capabilities={capabilities}
          />
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-1 text-[10px] text-text-faint">
        <Legend
          color={VOCAL_NOTE_COLOR}
          label={`${doc.segments.length} notes${lowConfidence > 0 ? ` (${lowConfidence} uncertain, dashed)` : ''}`}
        />
        <Legend color="#9298A5" line label="Sung pitch" />
        <Legend color={TARGET_LINE_COLOR} line label="Corrected pitch" />
        {(['breath', 'sibilant', 'unvoiced'] as const).map((kind) => (
          <Legend key={kind} color={NON_PITCHED_COLORS[kind]} label={NON_PITCHED_LABELS[kind]} />
        ))}
        <span className="flex-1" />
        <span data-testid="vocal-limitations">
          Monophonic vocals only · large pitch moves can sound processed · timing edits are not
          available.
        </span>
      </div>
      <div id={liveId} className="sr-only" aria-live="polite" data-testid="vocal-live">
        {summarizeSelection(chosen, doc)}
      </div>
    </div>
  );
}

function Legend({ color, label, line = false }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className={line ? 'h-0.5 w-3 rounded-full' : 'size-2 rounded-sm'}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
