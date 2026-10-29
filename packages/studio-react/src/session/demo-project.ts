/**
 * Starter content. `createStarterProject` gives new users an instrument track to play into;
 * `createDemoProject` builds a short original groove (drums, bass, keys) so every feature
 * has something audible to work on. All note data here is original.
 */
import {
  createEmptyProject,
  createInstrumentConfig,
  createMidiClip,
  createTrack,
  PPQ,
  type IdFactory,
  type MidiNote,
  type Project,
} from '@studio/domain';

export function createStarterProject(ids: IdFactory, now: string): Project {
  const project = createEmptyProject({ id: ids.create('project'), name: 'Untitled Project', now });
  const keys = createTrack({ id: ids.create('track'), kind: 'instrument', index: 0, name: 'Keys', instrument: createInstrumentConfig('synth', 'synth.keys') });
  return { ...project, trackOrder: [keys.id], tracks: { [keys.id]: keys } };
}

type NoteSpec = readonly [startSixteenth: number, pitch: number, lengthSixteenths: number, velocity: number];

function notes(ids: IdFactory, specs: readonly NoteSpec[]): MidiNote[] {
  const s = PPQ / 4;
  return specs.map(([start, pitch, length, velocity]) => ({
    id: ids.create('note'),
    startTick: start * s,
    durationTicks: length * s,
    pitch,
    velocity,
  }));
}

export function createDemoProject(ids: IdFactory, now: string): Project {
  const base = createEmptyProject({ id: ids.create('project'), name: 'Demo Groove', now, bpm: 96 });
  const drums = createTrack({ id: ids.create('track'), kind: 'instrument', index: 0, name: 'Drums', instrument: createInstrumentConfig('drums') });
  const bass = createTrack({ id: ids.create('track'), kind: 'instrument', index: 1, name: 'Bass', instrument: createInstrumentConfig('synth', 'synth.bass') });
  const keys = createTrack({ id: ids.create('track'), kind: 'instrument', index: 2, name: 'Keys', instrument: createInstrumentConfig('synth', 'synth.keys') });
  const bar = PPQ * 4;

  const drumPattern: NoteSpec[] = [];
  for (let b = 0; b < 2; b++) {
    const o = b * 16;
    drumPattern.push([o, 36, 1, 112], [o + 7, 36, 1, 90], [o + 10, 36, 1, 104]);
    drumPattern.push([o + 4, 38, 1, 108], [o + 12, 38, 1, 110]);
    for (let i = 0; i < 16; i += 2) drumPattern.push([o + i, 42, 1, i % 4 === 0 ? 96 : 70]);
  }
  drumPattern.push([30, 46, 2, 84]);

  // Bass: A minor-ish line (A2, C3, G2, E2) — original.
  const bassLine: NoteSpec[] = [
    [0, 45, 3, 104], [4, 45, 2, 92], [7, 48, 2, 96], [10, 43, 3, 98], [14, 40, 2, 90],
    [16, 45, 3, 104], [20, 45, 2, 92], [23, 52, 2, 96], [26, 50, 3, 98], [30, 48, 2, 90],
  ];
  // Keys: sustained chords Am7 → Fmaj7 (voicings original).
  const chords: NoteSpec[] = [
    [0, 57, 15, 78], [0, 60, 15, 74], [0, 64, 15, 74], [0, 67, 15, 70],
    [16, 53, 15, 78], [16, 57, 15, 74], [16, 60, 15, 74], [16, 64, 15, 70],
  ];

  const drumClip = createMidiClip({ id: ids.create('clip'), trackId: drums.id, startTick: 0, lengthTicks: bar * 4, name: 'Beat', notes: notes(ids, drumPattern) });
  const bassClip = createMidiClip({ id: ids.create('clip'), trackId: bass.id, startTick: 0, lengthTicks: bar * 4, name: 'Bassline', notes: notes(ids, bassLine) });
  const keysClip = createMidiClip({ id: ids.create('clip'), trackId: keys.id, startTick: 0, lengthTicks: bar * 4, name: 'Chords', notes: notes(ids, chords) });

  return {
    ...base,
    loop: { enabled: true, startTick: 0, endTick: bar * 2 },
    trackOrder: [drums.id, bass.id, keys.id],
    tracks: { [drums.id]: drums, [bass.id]: bass, [keys.id]: keys },
    clips: {
      [drumClip.id]: { ...drumClip, loopLengthTicks: bar * 2 },
      [bassClip.id]: { ...bassClip, loopLengthTicks: bar * 2 },
      [keysClip.id]: { ...keysClip, loopLengthTicks: bar * 2 },
    },
  };
}
