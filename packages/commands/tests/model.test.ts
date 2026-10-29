/**
 * Model-based property test: random sequences of *valid* commands (built against the
 * current state) are executed through a CommandHistory. After every step the project
 * must satisfy every invariant; absolute commands must be idempotent (re-applying returns
 * the same root); and undoing everything must return the initial root while redoing
 * everything returns the final root, both by reference.
 */
import {
  EFFECT_KINDS,
  EFFECT_PARAM_SPECS,
  INSTRUMENT_PARAM_SPECS,
  asAssetId,
  asClipId,
  asEffectId,
  asMappingId,
  asNoteId,
  asTrackId,
  asVocalNoteId,
  checkProjectInvariants,
  clipEndTick,
  createEffectSlot,
  createInstrumentConfig,
  createMidiMapping,
  createTrack,
  type AssetRef,
  type Clip,
  type MidiNote,
  type Project,
  type Track,
  type TrackKind,
  type VocalNoteSegment,
} from '@studio/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyCommand, createHistory, type Command, type CommandType } from '../src';
import { deepFreeze, makeAsset, makeProject, makeVocalDoc } from './fixtures';

interface Op {
  readonly kind: number;
  readonly mode: number;
  readonly r: readonly number[];
}

const opArb: fc.Arbitrary<Op> = fc.record({
  kind: fc.nat(1000),
  mode: fc.nat(9),
  r: fc.array(fc.nat(1_000_000), { minLength: 12, maxLength: 12 }),
});

/** Commands whose re-application to their own result must be a no-op. */
const IDEMPOTENT = new Set<CommandType>([
  'project.rename',
  'project.setTempo',
  'project.setMeter',
  'project.setLoop',
  'project.setMetronome',
  'track.update',
  'track.setMixer',
  'track.setInstrumentParams',
  'effect.setParams',
  'effect.setBypass',
  'master.setGain',
  'clip.move',
  'clip.updateMidi',
  'clip.updateAudio',
  'notes.update',
  'vocal.setCorrection',
  'vocal.setNoteEdits',
  'vocal.setEnabled',
  'mapping.update',
]);

class Rand {
  private i = 0;
  constructor(private readonly values: readonly number[]) {}
  next(): number {
    const v = this.values[this.i % this.values.length]!;
    this.i++;
    return v + this.i * 7919;
  }
  int(max: number): number {
    return max <= 0 ? 0 : this.next() % max;
  }
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }
  bool(): boolean {
    return this.int(2) === 1;
  }
  pick<T>(items: readonly T[]): T | undefined {
    return items.length === 0 ? undefined : items[this.int(items.length)];
  }
  subset<T>(items: readonly T[]): T[] {
    return items.filter(() => this.bool());
  }
}

type Builder = (p: Project, r: Rand, id: (prefix: string) => string) => Command | null;

const tracks = (p: Project, kind?: TrackKind): Track[] =>
  Object.values(p.tracks).filter((t) => kind === undefined || t.kind === kind);
const audioCapable = (p: Project) => tracks(p).filter((t) => t.kind !== 'instrument');
const clips = (p: Project, kind?: Clip['kind']): Clip[] =>
  Object.values(p.clips).filter((c) => kind === undefined || c.kind === kind);
const effectTargets = (p: Project) => [
  ...tracks(p).map((t) => ({ target: t.id as Track['id'] | 'master', effects: t.effects })),
  { target: 'master' as const, effects: p.master.effects },
];
const hex = (n: number) => `#${(n % 0xffffff).toString(16).padStart(6, '0')}`;

function randomNotes(r: Rand, id: (prefix: string) => string, count: number): MidiNote[] {
  return Array.from({ length: count }, () => ({
    id: asNoteId(id('nte')),
    startTick: r.int(4000),
    durationTicks: r.range(1, 1000),
    pitch: r.int(128),
    velocity: r.range(-20, 160), // clamped by the command
  }));
}

function randomSegments(
  r: Rand,
  id: (prefix: string) => string,
  count: number,
): VocalNoteSegment[] {
  return Array.from({ length: count }, () => {
    const start = r.int(10_000) / 1000;
    return {
      id: asVocalNoteId(id('vn')),
      startSeconds: start,
      endSeconds: start + r.range(1, 2000) / 1000,
      detectedMidi: 40 + r.int(4000) / 100,
      confidence: r.int(101) / 100,
      vibratoDepthCents: r.int(80),
      vibratoRateHz: r.int(8),
      driftCents: r.int(40) - 20,
    };
  });
}

function isAssetReferenced(p: Project, assetId: string): boolean {
  return (
    Object.values(p.clips).some((c) => c.kind === 'audio' && c.assetId === assetId) ||
    Object.values(p.tracks).some((t) => t.instrument?.sampleAssetId === assetId) ||
    Object.hasOwn(p.vocalEdits, assetId)
  );
}

const BUILDERS: Builder[] = [
  // project
  (_p, r) => ({ type: 'project.rename', name: `Song ${r.int(5)}` }),
  (_p, r) => ({ type: 'project.setTempo', bpm: r.range(10, 450) + r.int(1000) / 1000 }),
  (_p, r) => ({
    type: 'project.setMeter',
    meter: { numerator: r.range(1, 12), denominator: r.pick([2, 4, 8, 16] as const)! },
  }),
  (_p, r) => {
    const start = r.int(20_000);
    return {
      type: 'project.setLoop',
      loop: { enabled: r.bool(), startTick: start, endTick: start + r.range(1, 20_000) },
    };
  },
  (_p, r) => ({
    type: 'project.setMetronome',
    metronome: { enabled: r.bool(), gainDb: r.range(-90, 20), countInBars: r.range(-1, 6) },
  }),
  // tracks
  (p, r, id) => {
    const kind = r.pick<TrackKind>(['audio', 'instrument', 'vocal'])!;
    const instrument =
      kind === 'instrument'
        ? createInstrumentConfig(r.pick(['synth', 'drums', 'sampler'] as const)!)
        : undefined;
    const track = createTrack({
      id: asTrackId(id('trk')),
      kind,
      index: r.int(8),
      ...(instrument ? { instrument } : {}),
    });
    return { type: 'track.add', track, index: r.int(p.trackOrder.length + 3) - 1 };
  },
  (p, r) => {
    const t = r.pick(tracks(p));
    return t ? { type: 'track.remove', trackId: t.id } : null;
  },
  (p, r) => {
    const t = r.pick(tracks(p));
    if (!t) return null;
    return {
      type: 'track.update',
      trackId: t.id,
      patch: {
        name: ` Track ${r.int(9)} `,
        color: hex(r.next()),
        armed: r.bool(),
        monitor: r.pick(['off', 'auto', 'on'] as const)!,
        ...(t.kind === 'instrument'
          ? {
              midiInput: {
                channel: r.pick(['all', 1, 10, 16] as const)!,
                transpose: r.range(-60, 60),
              },
            }
          : { inputChannels: r.pick([1, 2] as const)! }),
      },
    };
  },
  (p, r) => {
    const t = r.pick(tracks(p));
    return t
      ? { type: 'track.move', trackId: t.id, toIndex: r.int(p.trackOrder.length + 2) - 1 }
      : null;
  },
  (p, r) => {
    const t = r.pick(tracks(p));
    if (!t) return null;
    return {
      type: 'track.setMixer',
      trackId: t.id,
      mixer: {
        gainDb: r.range(-80, 12),
        pan: (r.int(301) - 150) / 100,
        mute: r.bool(),
        solo: r.bool(),
      },
    };
  },
  (p, r) => {
    const t = r.pick(tracks(p, 'instrument'));
    if (!t?.instrument) return null;
    const spec = r.pick(INSTRUMENT_PARAM_SPECS[t.instrument.kind])!;
    return {
      type: 'track.setInstrumentParams',
      trackId: t.id,
      params: { [spec.id]: spec.min - 1 + (r.int(1000) / 1000) * (spec.max - spec.min + 2) },
    };
  },
  (p, r) => {
    const t = r.pick(tracks(p, 'instrument'));
    if (!t) return null;
    const assets = Object.keys(p.assets);
    const sampler = r.bool() && assets.length > 0;
    return {
      type: 'track.setInstrument',
      trackId: t.id,
      instrument: sampler
        ? { ...createInstrumentConfig('sampler'), sampleAssetId: asAssetId(r.pick(assets)!) }
        : createInstrumentConfig(r.pick(['synth', 'drums'] as const)!),
    };
  },
  // effects
  (p, r, id) => {
    const { target, effects } = r.pick(effectTargets(p))!;
    return {
      type: 'effect.add',
      target,
      effect: createEffectSlot(asEffectId(id('fx')), r.pick(EFFECT_KINDS)!),
      index: r.int(effects.length + 3) - 1,
    };
  },
  (p, r) => {
    const chain = r.pick(effectTargets(p).filter((c) => c.effects.length > 0));
    const effect = chain && r.pick(chain.effects);
    if (!chain || !effect) return null;
    switch (r.int(4)) {
      case 0:
        return { type: 'effect.remove', target: chain.target, effectId: effect.id };
      case 1:
        return {
          type: 'effect.move',
          target: chain.target,
          effectId: effect.id,
          toIndex: r.int(chain.effects.length + 2) - 1,
        };
      case 2: {
        const spec = r.pick(EFFECT_PARAM_SPECS[effect.kind])!;
        return {
          type: 'effect.setParams',
          target: chain.target,
          effectId: effect.id,
          params: { [spec.id]: spec.min + (r.int(1200) / 1000 - 0.1) * (spec.max - spec.min) },
        };
      }
      default:
        return {
          type: 'effect.setBypass',
          target: chain.target,
          effectId: effect.id,
          bypass: r.bool(),
        };
    }
  },
  (_p, r) => ({ type: 'master.setGain', gainDb: r.range(-90, 20) }),
  // clips
  (p, r, id) => {
    const t = r.pick(tracks(p, 'instrument'));
    if (!t) return null;
    return {
      type: 'clip.add',
      clips: [
        {
          id: asClipId(id('clp')),
          kind: 'midi',
          trackId: t.id,
          name: 'Clip',
          startTick: r.int(20_000),
          lengthTicks: r.range(1, 8000),
          contentOffsetTicks: r.int(500),
          muted: false,
          notes: randomNotes(r, id, r.int(6)),
          ...(r.bool() ? { loopLengthTicks: r.range(1, 2000) } : {}),
        },
      ],
    };
  },
  (p, r, id) => {
    const t = r.pick(audioCapable(p));
    const asset = r.pick(Object.values(p.assets));
    if (!t || !asset || asset.frames < 1) return null;
    const loop = r.bool();
    return {
      type: 'clip.add',
      clips: [
        {
          id: asClipId(id('clp')),
          kind: 'audio',
          trackId: t.id,
          assetId: asset.id,
          name: 'Audio',
          startTick: r.int(20_000),
          muted: false,
          sourceStartFrame: r.int(asset.frames),
          lengthFrames: r.range(1, 300_000),
          gainDb: r.range(-70, 20),
          fadeInFrames: r.int(50_000),
          fadeOutFrames: r.int(50_000),
          ...(loop ? { loopLengthFrames: r.range(1, 100_000) } : {}),
        },
      ],
    };
  },
  (p, r) => {
    const selected = r.subset(clips(p));
    return selected.length > 0 ? { type: 'clip.remove', clipIds: selected.map((c) => c.id) } : null;
  },
  (p, r) => {
    const selected = r.subset(clips(p));
    if (selected.length === 0) return null;
    return {
      type: 'clip.move',
      moves: selected.map((c) => {
        const destination =
          c.kind === 'midi' ? r.pick(tracks(p, 'instrument')) : r.pick(audioCapable(p));
        return {
          clipId: c.id,
          startTick: r.int(30_000),
          ...(r.bool() && destination ? { trackId: destination.id } : {}),
        };
      }),
    };
  },
  (p, r) => {
    const c = r.pick(clips(p));
    if (!c) return null;
    if (c.kind === 'midi') {
      return {
        type: 'clip.updateMidi',
        clipId: c.id,
        patch: {
          name: `M${r.int(3)}`,
          muted: r.bool(),
          color: hex(r.next()),
          loopLengthTicks: r.bool() ? null : r.range(1, 3000),
        },
      };
    }
    const patch: Record<string, unknown> = { gainDb: r.range(-80, 30), muted: r.bool() };
    if (r.bool()) patch.fadeInFrames = r.range(-100, 200_000);
    if (r.bool()) patch.fadeOutFrames = r.range(-100, 200_000);
    if (r.bool()) patch.loopLengthFrames = r.bool() ? null : r.range(1, 100_000);
    return { type: 'clip.updateAudio', clipId: c.id, patch };
  },
  (p, r) => {
    const c = r.pick(clips(p));
    if (!c) return null;
    const end = clipEndTick(c, p);
    let start = r.int(Math.ceil(end) + 1);
    if (start >= end) start = Math.ceil(end) - 1;
    return start >= 0 ? { type: 'clip.trimStart', clipId: c.id, startTick: start } : null;
  },
  (p, r) => {
    const c = r.pick(clips(p));
    return c
      ? { type: 'clip.trimEnd', clipId: c.id, endTick: c.startTick + r.range(1, 12_000) }
      : null;
  },
  (p, r, id) => {
    const c = r.pick(clips(p));
    if (!c) return null;
    const last = Math.ceil(clipEndTick(c, p)) - 1;
    if (last <= c.startTick) return null;
    return {
      type: 'clip.split',
      clipId: c.id,
      atTick: r.range(c.startTick + 1, last),
      newClipId: asClipId(id('clp')),
    };
  },
  // notes
  (p, r, id) => {
    const c = r.pick(clips(p, 'midi'));
    return c ? { type: 'notes.add', clipId: c.id, notes: randomNotes(r, id, r.range(1, 4)) } : null;
  },
  (p, r) => {
    const c = r.pick(clips(p, 'midi'));
    if (c?.kind !== 'midi') return null;
    return { type: 'notes.remove', clipId: c.id, noteIds: r.subset(c.notes).map((n) => n.id) };
  },
  (p, r) => {
    const c = r.pick(clips(p, 'midi'));
    if (c?.kind !== 'midi') return null;
    return {
      type: 'notes.update',
      clipId: c.id,
      patches: r.subset(c.notes).map((n) => ({
        id: n.id,
        ...(r.bool() ? { startTick: r.range(-100, 5000) } : {}),
        ...(r.bool() ? { durationTicks: r.range(-10, 2000) } : {}),
        ...(r.bool() ? { pitch: r.range(-10, 140) } : {}),
        ...(r.bool() ? { velocity: r.range(-10, 140) } : {}),
      })),
    };
  },
  (p, r) => {
    const c = r.pick(clips(p, 'midi'));
    if (c?.kind !== 'midi') return null;
    return {
      type: 'notes.quantize',
      clipId: c.id,
      noteIds: r.subset(c.notes).map((n) => n.id),
      options: {
        gridTicks: r.pick([0, 80, 120, 240, 480, 960])!,
        strength: r.int(11) / 10,
        swing: r.int(11) / 10,
        quantizeEnds: r.bool(),
      },
    };
  },
  // assets
  (_p, r, id) => ({
    type: 'asset.register',
    asset: makeAsset({
      id: asAssetId(id('ast')),
      sampleRate: r.pick([22_050, 44_100, 48_000])!,
      frames: r.range(1, 600_000),
      contentHash: `h${r.next()}`,
    }),
  }),
  (p, r) => {
    const free = Object.values(p.assets).filter((a: AssetRef) => !isAssetReferenced(p, a.id));
    const asset = r.pick(free);
    return asset ? { type: 'asset.remove', assetId: asset.id } : null;
  },
  // vocal editing
  (p, r, id) => {
    const asset = r.pick(Object.values(p.assets));
    if (!asset) return null;
    return {
      type: 'vocal.setDoc',
      doc: makeVocalDoc({
        assetId: asset.id,
        segments: randomSegments(r, id, r.int(5)),
        noteEdits: {},
      }),
    };
  },
  (p, r, id) => {
    const doc = r.pick(Object.values(p.vocalEdits));
    if (!doc) return null;
    const noteIds = doc.segments.map((s) => s.id);
    switch (r.int(7)) {
      case 0:
        return { type: 'vocal.removeDoc', assetId: doc.assetId };
      case 1:
        return {
          type: 'vocal.setCorrection',
          assetId: doc.assetId,
          correction: {
            amount: r.range(-1, 3) / 2,
            humanize: r.int(3) / 2,
            retuneSpeedMs: r.range(-100, 2000),
            formantShiftSemitones: r.range(-20, 20),
            key: r.bool()
              ? null
              : {
                  tonic: r.pick([0, 2, 9] as const)!,
                  scale: r.pick(['major', 'naturalMinor', 'dorian'] as const)!,
                },
          },
        };
      case 2: {
        const edits: Record<string, object> = {};
        for (const nid of r.subset(noteIds)) {
          edits[nid] = {
            targetMidi: r.range(-5, 140),
            driftCorrection: r.int(3) / 2,
            modulationScale: r.int(6) / 2,
            transitionMs: r.range(-10, 2000),
            bypass: r.bool(),
          };
        }
        return { type: 'vocal.setNoteEdits', assetId: doc.assetId, edits };
      }
      case 3:
        return { type: 'vocal.clearTargets', assetId: doc.assetId, noteIds: r.subset(noteIds) };
      case 4:
        return { type: 'vocal.resetNotes', assetId: doc.assetId, noteIds: r.subset(noteIds) };
      case 5:
        return {
          type: 'vocal.replaceSegments',
          assetId: doc.assetId,
          removeIds: r.subset(noteIds),
          add: randomSegments(r, id, r.int(3)),
        };
      default:
        return { type: 'vocal.setEnabled', assetId: doc.assetId, enabled: r.bool() };
    }
  },
  // mappings
  (p, r, id) => {
    const t = r.pick(tracks(p));
    return {
      type: 'mapping.add',
      mapping: createMidiMapping({
        id: asMappingId(id('map')),
        source: {
          kind: 'cc',
          channel: r.pick(['any', 1, 16] as const)!,
          controller: r.int(128),
          mode: 'absolute',
        },
        target:
          t && r.bool()
            ? { kind: 'parameter', address: { scope: 'track', trackId: t.id, param: 'pan' } }
            : { kind: 'action', action: 'transport.togglePlay' },
        transform: { min: r.int(3) / 2 - 0.5, max: r.int(3) / 2 + 0.5 },
      }),
    };
  },
  (p, r) => {
    const m = r.pick(p.midiMappings);
    if (!m) return null;
    return r.bool()
      ? {
          type: 'mapping.update',
          mappingId: m.id,
          patch: { enabled: r.bool(), label: `L${r.int(3)}` },
        }
      : { type: 'mapping.remove', mappingIds: r.subset(p.midiMappings).map((x) => x.id) };
  },
];

function describeFailure(command: Command, error: unknown): string {
  return `${command.type} failed: ${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(command)}`;
}

describe('model-based command sequences', () => {
  it('preserve invariants and undo/redo exactly', () => {
    const appliedByType = new Map<CommandType, number>();
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 5, maxLength: 60, size: 'max' }), (ops) => {
        const initial = makeProject();
        const history = createHistory(initial, { limit: 10_000 });
        let counter = 0;
        const id = (prefix: string) => `${prefix}_m${++counter}`;
        let applied = 0;

        for (const op of ops) {
          const r = new Rand(op.r);
          const before = history.present;
          const command = BUILDERS[op.kind % BUILDERS.length]!(before, r, id);
          if (!command) continue;

          let result;
          if (op.mode === 0) {
            const tx = history.beginTransaction('tx');
            result = tx.apply(command);
            if (r.bool()) tx.commit();
            else tx.cancel();
          } else if (op.mode === 1) {
            result = history.executeBatch(
              [command, command].slice(0, IDEMPOTENT.has(command.type) ? 2 : 1),
            );
          } else {
            result = history.execute(
              command,
              op.mode < 4 ? { coalesceKey: command.type } : undefined,
            );
          }
          if (!result.ok) expect.fail(describeFailure(command, result.error));
          applied++;
          appliedByType.set(command.type, (appliedByType.get(command.type) ?? 0) + 1);

          deepFreeze(history.present); // later commands would throw if they mutated it
          expect(checkProjectInvariants(history.present), command.type).toEqual([]);
          expect(history.present.updatedAt).toBe(initial.updatedAt);
          if (IDEMPOTENT.has(command.type) && result.value === history.present) {
            expect(
              applyCommand(history.present, command),
              `${command.type} is not idempotent`,
            ).toBe(history.present);
          }
        }

        const final = history.present;
        while (history.undo()) {
          expect(checkProjectInvariants(history.present)).toEqual([]);
        }
        expect(history.present).toBe(initial);
        while (history.redo());
        expect(history.present).toBe(final);
        return applied >= 0;
      }),
      { numRuns: 300 },
    );
    // Guard against a generator that silently stops producing commands.
    const total = [...appliedByType.values()].reduce((a, b) => a + b, 0);
    console.log(`model test: ${total} commands applied across ${appliedByType.size} command types`);
    expect(appliedByType.size).toBeGreaterThanOrEqual(42);
    expect(total).toBeGreaterThan(3000);
  });
});
