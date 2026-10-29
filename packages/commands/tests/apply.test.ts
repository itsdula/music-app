import { asTrackId } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import { CommandError, applyCommand, applyCommands, type Command } from '../src';
import { ids, makeProject } from './fixtures';

describe('applyCommand', () => {
  it('tags errors with the command type', () => {
    try {
      applyCommand(makeProject(), { type: 'track.remove', trackId: asTrackId('missing') });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError);
      expect(error).toMatchObject({
        name: 'CommandError',
        code: 'not-found',
        commandType: 'track.remove',
      });
    }
  });

  it('rejects unknown command types', () => {
    expect(() =>
      applyCommand(makeProject(), { type: 'track.explode' } as unknown as Command),
    ).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
  });

  it('does not wrap errors that are not CommandErrors', () => {
    const hostile = {
      type: 'project.rename',
      get name(): string {
        throw new RangeError('boom');
      },
    } as unknown as Command;
    expect(() => applyCommand(makeProject(), hostile)).toThrow(RangeError);
  });

  it('never touches updatedAt', () => {
    const p = makeProject();
    const next = applyCommands(p, [
      { type: 'project.rename', name: 'X' },
      { type: 'project.setTempo', bpm: 90 },
      { type: 'track.remove', trackId: ids.vocal },
    ]);
    expect(next.updatedAt).toBe(p.updatedAt);
  });
});

describe('applyCommands', () => {
  it('applies commands in order', () => {
    const next = applyCommands(makeProject(), [
      { type: 'project.setTempo', bpm: 90 },
      { type: 'project.setTempo', bpm: 100 },
    ]);
    expect(next.bpm).toBe(100);
  });

  it('returns the input for an empty list or all no-ops', () => {
    const p = makeProject();
    expect(applyCommands(p, [])).toBe(p);
    expect(applyCommands(p, [{ type: 'project.setTempo', bpm: 120 }])).toBe(p);
  });

  it('throws on the first invalid command, leaving the input untouched', () => {
    const p = makeProject();
    const snapshot = JSON.stringify(p);
    expect(() =>
      applyCommands(p, [
        { type: 'project.setTempo', bpm: 90 },
        { type: 'track.remove', trackId: asTrackId('missing') },
        { type: 'project.setTempo', bpm: 1 },
      ]),
    ).toThrow(expect.objectContaining({ commandType: 'track.remove' }));
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});
