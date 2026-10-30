/**
 * Evaluates tutorial conditions against a snapshot of session state. Pure: the controller
 * builds the snapshot from the session's stores; tests can build one by hand.
 */
import type { MidiMapping, Project } from '@studio/domain';
import type { MidiAccessStatus } from '@studio/midi-core';
import type { StudioSession } from '../../session/studio-session';
import type { EngineStoreState } from '../../state/engine-store';
import type { UiState } from '../../state/ui-store';
import type { CountRule, TutorialCondition } from './schema';

export interface TutorialSnapshot {
  readonly project: Project;
  readonly ui: Pick<UiState, 'view' | 'panels' | 'selection' | 'assistantOpen' | 'audioEditorMode'>;
  readonly engine: Pick<EngineStoreState, 'playState' | 'recording'>;
  readonly midi: {
    readonly status: MidiAccessStatus;
    readonly globalMappings: readonly MidiMapping[];
  };
}

export function snapshotSession(session: StudioSession): TutorialSnapshot {
  const midi = session.midi.store.getState();
  return {
    project: session.history.present,
    ui: session.uiStore.getState(),
    engine: session.engineStore.getState(),
    midi: { status: midi.status, globalMappings: midi.globalMappings },
  };
}

/** Values captured when a step starts; `added` rules and "changed" conditions compare to it. */
export type TutorialBaseline = Readonly<Record<string, number | string>>;

function openClip(s: TutorialSnapshot) {
  const id = s.ui.selection.editorClipId;
  return id ? s.project.clips[id] : undefined;
}

/** Counters and values that conditions read; the baseline is this at step start. */
export function measure(s: TutorialSnapshot): TutorialBaseline {
  const tracks = Object.values(s.project.tracks);
  const clips = Object.values(s.project.clips);
  const clip = openClip(s);
  const values: Record<string, number | string> = {
    projectId: s.project.id,
    projectName: s.project.name,
    bpm: s.project.bpm,
    tracks: tracks.length,
    'tracks:instrument': 0,
    'tracks:audio': 0,
    'tracks:vocal': 0,
    clips: clips.length,
    'clips:midi': 0,
    'clips:audio': 0,
    notes: clip?.kind === 'midi' ? clip.notes.length : 0,
    effects: s.project.master.effects.length + tracks.reduce((sum, t) => sum + t.effects.length, 0),
    mappings: s.project.midiMappings.length + s.midi.globalMappings.length,
  };
  for (const t of tracks) values[`tracks:${t.kind}`] = (values[`tracks:${t.kind}`] as number) + 1;
  for (const c of clips) values[`clips:${c.kind}`] = (values[`clips:${c.kind}`] as number) + 1;
  return values;
}

function count(
  rule: CountRule,
  key: string,
  now: TutorialBaseline,
  baseline: TutorialBaseline,
): boolean {
  const value = Number(now[key] ?? 0);
  if (rule.added !== undefined) return value - Number(baseline[key] ?? 0) >= rule.added;
  return value >= (rule.min ?? 0);
}

function bottomPanelVisible(s: TutorialSnapshot): boolean {
  return s.ui.view === 'editor' || (s.ui.view === 'arrange' && s.ui.panels.bottomOpen);
}

export function evaluateCondition(
  condition: TutorialCondition,
  s: TutorialSnapshot,
  baseline: TutorialBaseline,
  now: TutorialBaseline = measure(s),
): boolean {
  const clip = openClip(s);
  const editorShowing = bottomPanelVisible(s) && s.ui.panels.bottomPanel === 'editor';
  switch (condition.type) {
    case 'view':
      return s.ui.view === condition.view;
    case 'panelOpen':
      return bottomPanelVisible(s) && s.ui.panels.bottomPanel === condition.panel;
    case 'assistantOpen':
      return s.ui.assistantOpen;
    case 'trackCount':
      return count(
        condition,
        condition.kind ? `tracks:${condition.kind}` : 'tracks',
        now,
        baseline,
      );
    case 'trackExists':
      return Number(now[`tracks:${condition.kind}`] ?? 0) > 0;
    case 'trackArmed':
      return Object.values(s.project.tracks).some((t) => t.armed);
    case 'trackSelected':
      return s.ui.selection.trackId !== null && Boolean(s.project.tracks[s.ui.selection.trackId]);
    case 'clipCount':
      return count(condition, condition.kind ? `clips:${condition.kind}` : 'clips', now, baseline);
    case 'midiClipOpen':
      return editorShowing && clip?.kind === 'midi';
    case 'audioClipOpen':
      return editorShowing && clip?.kind === 'audio';
    case 'noClipOpen':
      return !clip;
    case 'pitchEditorOpen': {
      if (!editorShowing || clip?.kind !== 'audio') return false;
      const mode = s.ui.audioEditorMode;
      if (mode !== 'auto') return mode === 'pitch';
      return s.project.tracks[clip.trackId]?.kind === 'vocal';
    }
    case 'noteCount':
      return clip?.kind === 'midi' && count(condition, 'notes', now, baseline);
    case 'playing':
      return s.engine.playState === 'playing';
    case 'stopped':
      return s.engine.playState === 'stopped';
    case 'recording':
      return s.engine.recording.phase === 'recording';
    case 'loopEnabled':
      return s.project.loop.enabled === (condition.value ?? true);
    case 'metronomeEnabled':
      return s.project.metronome.enabled === (condition.value ?? true);
    case 'tempoChanged':
      return now.bpm !== baseline.bpm;
    case 'effectCount':
      return count(condition, 'effects', now, baseline);
    case 'projectRenamed':
      return now.projectId === baseline.projectId && now.projectName !== baseline.projectName;
    case 'projectChanged':
      return now.projectId !== baseline.projectId;
    case 'midiConnected':
      return s.midi.status === 'granted';
    case 'midiMappingCount':
      return count(condition, 'mappings', now, baseline);
    case 'vocalAnalyzed':
      return clip?.kind === 'audio' && Boolean(s.project.vocalEdits[clip.assetId]);
    case 'all':
      return condition.conditions.every((c) => evaluateCondition(c, s, baseline, now));
    case 'any':
      return condition.conditions.some((c) => evaluateCondition(c, s, baseline, now));
  }
}
