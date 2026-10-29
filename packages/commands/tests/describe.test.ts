import {
  asAssetId,
  asClipId,
  asEffectId,
  asMappingId,
  asNoteId,
  asVocalNoteId,
  createEffectSlot,
} from '@studio/domain';
import { describe, expect, it } from 'vitest';
import { describeCommand, describeCommands, type Command } from '../src';
import {
  ids,
  makeAsset,
  makeAudioClip,
  makeMidiClip,
  makeProject,
  makeVocalDoc,
  note,
  segment,
} from './fixtures';

const n = asNoteId;
const p = makeProject();

const CASES: [Command, string][] = [
  [{ type: 'project.rename', name: 'x' }, 'Rename Project'],
  [{ type: 'project.setTempo', bpm: 100 }, 'Set Tempo'],
  [{ type: 'project.setMeter', meter: { numerator: 3, denominator: 4 } }, 'Set Time Signature'],
  [{ type: 'project.setLoop', loop: { enabled: true } }, 'Set Loop'],
  [{ type: 'project.setMetronome', metronome: { enabled: true } }, 'Change Metronome'],
  [{ type: 'track.add', track: p.tracks[ids.audio]! }, 'Add Track'],
  [{ type: 'track.remove', trackId: ids.audio }, 'Delete Track'],
  [{ type: 'track.update', trackId: ids.audio, patch: { name: 'x' } }, 'Rename Track'],
  [{ type: 'track.update', trackId: ids.audio, patch: { color: '#000000' } }, 'Change Track Color'],
  [{ type: 'track.update', trackId: ids.audio, patch: { armed: true } }, 'Arm Track'],
  [{ type: 'track.update', trackId: ids.audio, patch: { armed: false } }, 'Disarm Track'],
  [{ type: 'track.update', trackId: ids.audio, patch: { monitor: 'on' } }, 'Change Monitoring'],
  [
    { type: 'track.update', trackId: ids.inst, patch: { midiInput: { channel: 1, transpose: 0 } } },
    'Change MIDI Input',
  ],
  [{ type: 'track.update', trackId: ids.audio, patch: { name: 'x', armed: true } }, 'Edit Track'],
  [{ type: 'track.update', trackId: ids.audio, patch: {} }, 'Edit Track'],
  [{ type: 'track.move', trackId: ids.audio, toIndex: 0 }, 'Move Track'],
  [{ type: 'track.setMixer', trackId: ids.audio, mixer: { gainDb: -3 } }, 'Change Volume'],
  [{ type: 'track.setMixer', trackId: ids.audio, mixer: { pan: 0.5 } }, 'Change Pan'],
  [{ type: 'track.setMixer', trackId: ids.audio, mixer: { mute: true } }, 'Mute Track'],
  [{ type: 'track.setMixer', trackId: ids.audio, mixer: { mute: false } }, 'Unmute Track'],
  [{ type: 'track.setMixer', trackId: ids.audio, mixer: { solo: true } }, 'Solo Track'],
  [{ type: 'track.setMixer', trackId: ids.audio, mixer: { solo: false } }, 'Unsolo Track'],
  [{ type: 'track.setMixer', trackId: ids.audio, mixer: { gainDb: 0, pan: 0 } }, 'Change Mixer'],
  [
    { type: 'track.setInstrument', trackId: ids.inst, instrument: p.tracks[ids.inst]!.instrument! },
    'Change Instrument',
  ],
  [
    { type: 'track.setInstrumentParams', trackId: ids.inst, params: {} },
    'Change Instrument Settings',
  ],
  [
    { type: 'effect.add', target: 'master', effect: createEffectSlot(asEffectId('r'), 'reverb') },
    'Add Reverb',
  ],
  [{ type: 'effect.remove', target: 'master', effectId: ids.masterFx }, 'Remove Effect'],
  [{ type: 'effect.move', target: 'master', effectId: ids.masterFx, toIndex: 0 }, 'Move Effect'],
  [
    { type: 'effect.setParams', target: 'master', effectId: ids.masterFx, params: {} },
    'Change Effect Settings',
  ],
  [
    { type: 'effect.setBypass', target: 'master', effectId: ids.masterFx, bypass: true },
    'Bypass Effect',
  ],
  [
    { type: 'effect.setBypass', target: 'master', effectId: ids.masterFx, bypass: false },
    'Enable Effect',
  ],
  [{ type: 'master.setGain', gainDb: 0 }, 'Change Master Volume'],
  [{ type: 'clip.add', clips: [makeMidiClip()] }, 'Add Clip'],
  [{ type: 'clip.add', clips: [makeMidiClip(), makeAudioClip()] }, 'Add 2 Clips'],
  [{ type: 'clip.remove', clipIds: [ids.midi] }, 'Delete Clip'],
  [{ type: 'clip.remove', clipIds: [ids.midi, ids.audioClip] }, 'Delete 2 Clips'],
  [{ type: 'clip.move', moves: [{ clipId: ids.midi, startTick: 0 }] }, 'Move Clip'],
  [{ type: 'clip.updateMidi', clipId: ids.midi, patch: { name: 'x' } }, 'Rename Clip'],
  [{ type: 'clip.updateMidi', clipId: ids.midi, patch: { muted: true } }, 'Mute Clip'],
  [{ type: 'clip.updateMidi', clipId: ids.midi, patch: { muted: false } }, 'Unmute Clip'],
  [{ type: 'clip.updateMidi', clipId: ids.midi, patch: { color: '#000000' } }, 'Change Clip Color'],
  [
    { type: 'clip.updateMidi', clipId: ids.midi, patch: { loopLengthTicks: null } },
    'Change Clip Loop',
  ],
  [{ type: 'clip.updateMidi', clipId: ids.midi, patch: { name: 'x', muted: true } }, 'Edit Clip'],
  [{ type: 'clip.updateAudio', clipId: ids.audioClip, patch: { fadeInFrames: 10 } }, 'Change Fade'],
  [{ type: 'clip.updateAudio', clipId: ids.audioClip, patch: { gainDb: 1 } }, 'Change Clip Gain'],
  [
    { type: 'clip.updateAudio', clipId: ids.audioClip, patch: { loopLengthFrames: 10 } },
    'Change Clip Loop',
  ],
  [{ type: 'clip.trimStart', clipId: ids.midi, startTick: 0 }, 'Trim Clip'],
  [{ type: 'clip.trimEnd', clipId: ids.midi, endTick: 9 }, 'Trim Clip'],
  [{ type: 'clip.split', clipId: ids.midi, atTick: 9, newClipId: asClipId('c') }, 'Split Clip'],
  [{ type: 'notes.add', clipId: ids.midi, notes: [note('a', 0)] }, 'Add Note'],
  [{ type: 'notes.add', clipId: ids.midi, notes: [note('a', 0), note('b', 0)] }, 'Add 2 Notes'],
  [{ type: 'notes.remove', clipId: ids.midi, noteIds: [n('a'), n('b'), n('c')] }, 'Delete 3 Notes'],
  [
    {
      type: 'notes.update',
      clipId: ids.midi,
      patches: [
        { id: n('a'), startTick: 1 },
        { id: n('b'), pitch: 3 },
        { id: n('c'), startTick: 2 },
      ],
    },
    'Move 3 Notes',
  ],
  [
    { type: 'notes.update', clipId: ids.midi, patches: [{ id: n('a'), durationTicks: 10 }] },
    'Resize Note',
  ],
  [
    {
      type: 'notes.update',
      clipId: ids.midi,
      patches: [
        { id: n('a'), velocity: 10 },
        { id: n('b'), velocity: 3 },
      ],
    },
    'Change Velocity',
  ],
  [
    {
      type: 'notes.update',
      clipId: ids.midi,
      patches: [{ id: n('a'), velocity: 10, startTick: 3 }],
    },
    'Edit Note',
  ],
  [
    { type: 'notes.update', clipId: ids.midi, patches: [{ id: n('a') }, { id: n('b'), pitch: 1 }] },
    'Edit 2 Notes',
  ],
  [
    {
      type: 'notes.quantize',
      clipId: ids.midi,
      noteIds: [n('a'), n('b')],
      options: { gridTicks: 240, strength: 1 },
    },
    'Quantize 2 Notes',
  ],
  [{ type: 'asset.register', asset: makeAsset() }, 'Add Audio File'],
  [{ type: 'asset.remove', assetId: asAssetId('a') }, 'Remove Audio File'],
  [{ type: 'vocal.setDoc', doc: makeVocalDoc() }, 'Analyze Vocal'],
  [{ type: 'vocal.removeDoc', assetId: ids.take }, 'Remove Vocal Edits'],
  [{ type: 'vocal.setCorrection', assetId: ids.take, correction: {} }, 'Change Pitch Correction'],
  [
    { type: 'vocal.setNoteEdits', assetId: ids.take, edits: { [ids.v1]: {}, [ids.v2]: {} } },
    'Edit 2 Vocal Notes',
  ],
  [{ type: 'vocal.clearTargets', assetId: ids.take, noteIds: [ids.v1] }, 'Clear Pitch Targets'],
  [{ type: 'vocal.resetNotes', assetId: ids.take, noteIds: [ids.v1] }, 'Reset Vocal Note'],
  [
    {
      type: 'vocal.replaceSegments',
      assetId: ids.take,
      removeIds: [ids.v1],
      add: [segment('a', 0, 1), segment('b', 1, 2)],
    },
    'Split Vocal Note',
  ],
  [
    {
      type: 'vocal.replaceSegments',
      assetId: ids.take,
      removeIds: [ids.v1, ids.v2],
      add: [segment('a', 0, 1)],
    },
    'Merge Vocal Notes',
  ],
  [
    {
      type: 'vocal.replaceSegments',
      assetId: ids.take,
      removeIds: [asVocalNoteId('x')],
      add: [segment('a', 0, 1)],
    },
    'Edit Vocal Notes',
  ],
  [{ type: 'vocal.setEnabled', assetId: ids.take, enabled: true }, 'Enable Pitch Correction'],
  [{ type: 'vocal.setEnabled', assetId: ids.take, enabled: false }, 'Bypass Pitch Correction'],
  [{ type: 'mapping.add', mapping: p.midiMappings[0]! }, 'Add MIDI Mapping'],
  [{ type: 'mapping.update', mappingId: ids.gainMapping, patch: {} }, 'Edit MIDI Mapping'],
  [
    { type: 'mapping.remove', mappingIds: [asMappingId('a'), asMappingId('b')] },
    'Remove 2 MIDI Mappings',
  ],
];

describe('describeCommand', () => {
  it.each(CASES.map(([command, label]) => ({ command, label, type: command.type })))(
    '$type -> "$label"',
    ({ command, label }) => {
      expect(describeCommand(command)).toBe(label);
    },
  );

  it('covers every command type', () => {
    expect(new Set(CASES.map(([c]) => c.type)).size).toBe(43);
  });

  it('falls back for unknown effect kinds and unknown command types', () => {
    expect(
      describeCommand({
        type: 'effect.add',
        target: 'master',
        effect: { ...createEffectSlot(asEffectId('x'), 'gain'), kind: 'odd' as 'gain' },
      }),
    ).toBe('Add Effect');
    expect(describeCommand({ type: 'nope' } as unknown as Command)).toBe('Edit');
  });
});

describe('describeCommands', () => {
  it('uses the shared label or a generic one', () => {
    expect(describeCommands([])).toBe('Edit');
    expect(describeCommands([CASES[1]![0]])).toBe('Set Tempo');
    expect(describeCommands([CASES[1]![0], CASES[1]![0]])).toBe('Set Tempo');
    expect(describeCommands([CASES[0]![0], CASES[1]![0]])).toBe('Multiple Edits');
  });
});
