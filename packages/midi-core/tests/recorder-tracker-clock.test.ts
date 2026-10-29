import { describe, expect, it } from 'vitest';
import { ActiveNoteTracker, MIDI_CLOCK_PPQN, MidiClockGenerator, MidiNoteRecorder } from '../src';
import { cc, ev, noteOff, noteOn } from './helpers';

/** 1 ms = 1 tick, offset so fractional timestamps exercise rounding. */
const recorder = () => new MidiNoteRecorder({ tickAt: (ms) => ms });
const at = (ms: number, message: Parameters<typeof ev>[0]) => ev(message, { timestampMs: ms });

describe('MidiNoteRecorder', () => {
  it('pairs note-on/off into integer-tick notes', () => {
    const r = recorder();
    r.handle(at(10.4, noteOn(60, 100)));
    r.handle(at(20.2, noteOn(64, 80)));
    r.handle(at(110.6, noteOff(60)));
    r.handle(at(220, noteOff(64)));
    expect(r.finish(1000)).toEqual([
      { pitch: 60, velocity: 100, startTick: 10, durationTicks: 101, channel: 1 },
      { pitch: 64, velocity: 80, startTick: 20, durationTicks: 200, channel: 1 },
    ]);
  });

  it('keeps notes on different channels apart and ignores unmatched note-offs', () => {
    const r = recorder();
    r.handle(at(0, noteOn(60, 100, 1)));
    r.handle(at(5, noteOn(60, 90, 2)));
    r.handle(at(7, noteOff(61)));
    r.handle(at(10, noteOff(60, 2)));
    r.handle(at(20, noteOff(60, 1)));
    r.handle(at(25, { type: 'clock' }));
    expect(r.finish(100)).toEqual([
      { pitch: 60, velocity: 100, startTick: 0, durationTicks: 20, channel: 1 },
      { pitch: 60, velocity: 90, startTick: 5, durationTicks: 5, channel: 2 },
    ]);
  });

  it('closes the previous instance when the same pitch is re-triggered', () => {
    const r = recorder();
    r.handle(at(0, noteOn(60, 100)));
    r.handle(at(50, noteOn(60, 70)));
    r.handle(at(80, noteOff(60)));
    r.handle(at(90, noteOff(60))); // second off is ignored
    expect(r.finish(200)).toEqual([
      { pitch: 60, velocity: 100, startTick: 0, durationTicks: 50, channel: 1 },
      { pitch: 60, velocity: 70, startTick: 50, durationTicks: 30, channel: 1 },
    ]);
  });

  it('guarantees a minimum duration of 1 tick', () => {
    const r = recorder();
    r.handle(at(5, noteOn(60)));
    r.handle(at(5.2, noteOff(60)));
    expect(r.finish(10)[0]?.durationTicks).toBe(1);
  });

  it('extends notes released under the sustain pedal until pedal-up', () => {
    const r = recorder();
    r.handle(at(0, noteOn(60)));
    r.handle(at(10, cc(64, 127)));
    r.handle(at(20, noteOff(60)));
    r.handle(at(30, noteOn(62)));
    r.handle(at(40, noteOff(62)));
    r.handle(at(45, noteOn(64)));
    r.handle(at(100, cc(64, 0)));
    r.handle(at(120, noteOff(64))); // still held after pedal-up: ends at its own off
    expect(r.finish(500).map((n) => [n.pitch, n.startTick, n.durationTicks])).toEqual([
      [60, 0, 100],
      [62, 30, 70],
      [64, 45, 75],
    ]);
  });

  it('a note pressed before the pedal and released after pedal-up is unaffected', () => {
    const r = recorder();
    r.handle(at(0, noteOn(60)));
    r.handle(at(10, cc(64, 100)));
    r.handle(at(20, cc(64, 10)));
    r.handle(at(30, noteOff(60)));
    expect(r.finish(100)[0]?.durationTicks).toBe(30);
  });

  it('re-striking a sustained pitch closes the sustained instance', () => {
    const r = recorder();
    r.handle(at(0, cc(64, 127)));
    r.handle(at(0, noteOn(60, 100)));
    r.handle(at(10, noteOff(60)));
    r.handle(at(30, noteOn(60, 50)));
    r.handle(at(40, noteOff(60)));
    r.handle(at(60, cc(64, 0)));
    expect(r.finish(100).map((n) => [n.velocity, n.startTick, n.durationTicks])).toEqual([
      [100, 0, 30],
      [50, 30, 30],
    ]);
  });

  it('sustain is per channel, and pedal-up without pedal-down is harmless', () => {
    const r = recorder();
    r.handle(at(0, cc(64, 0)));
    r.handle(at(0, cc(64, 127, 2)));
    r.handle(at(0, noteOn(60)));
    r.handle(at(10, noteOff(60)));
    expect(r.finish(100)[0]?.durationTicks).toBe(10);
  });

  it('closes held and sustained notes at finish and resets for reuse', () => {
    const r = recorder();
    r.handle(at(0, noteOn(60)));
    r.handle(at(0, cc(64, 127)));
    r.handle(at(10, noteOn(62)));
    r.handle(at(20, noteOff(62)));
    expect(r.openCount).toBe(2);
    expect(r.finish(99.6).map((n) => [n.pitch, n.durationTicks])).toEqual([
      [60, 100],
      [62, 90],
    ]);
    expect(r.openCount).toBe(0);
    expect(r.finish(200)).toEqual([]);
  });

  it('All Notes Off / All Sound Off close notes on that channel', () => {
    const r = recorder();
    r.handle(at(0, noteOn(60)));
    r.handle(at(0, noteOn(61, 100, 2)));
    r.handle(at(5, cc(64, 127)));
    r.handle(at(6, noteOn(62)));
    r.handle(at(7, noteOff(62)));
    r.handle(at(20, cc(123, 0)));
    r.handle(at(30, cc(120, 0, 2)));
    expect(r.finish(100).map((n) => [n.pitch, n.durationTicks])).toEqual([
      [60, 20],
      [61, 30],
      [62, 14],
    ]);
  });

  it('reset discards everything', () => {
    const r = recorder();
    r.handle(at(0, noteOn(60)));
    r.reset();
    expect(r.finish(10)).toEqual([]);
  });
});

describe('ActiveNoteTracker', () => {
  it('tracks notes per port/channel and releases them as velocity-0 note-offs', () => {
    const t = new ActiveNoteTracker();
    t.handle(ev(noteOn(60), { portId: 'b', portName: 'B', profileId: 'p' }));
    t.handle(ev(noteOn(62, 90, 2)));
    t.handle(ev(noteOn(61)));
    t.handle(ev(noteOn(61))); // retrigger counts once
    expect(t.activeCount()).toBe(3);
    expect(t.activeCount('in-1')).toBe(2);
    expect(t.isActive('b', 1, 60)).toBe(true);
    expect(t.releaseAll('in-1')).toEqual([
      {
        portId: 'in-1',
        portName: 'Test Keys',
        message: { type: 'noteOff', channel: 1, note: 61, velocity: 0 },
      },
      {
        portId: 'in-1',
        portName: 'Test Keys',
        message: { type: 'noteOff', channel: 2, note: 62, velocity: 0 },
      },
    ]);
    expect(t.releaseAll()).toEqual([
      {
        portId: 'b',
        portName: 'B',
        profileId: 'p',
        message: { type: 'noteOff', channel: 1, note: 60, velocity: 0 },
      },
    ]);
    expect(t.releaseAll()).toEqual([]);
  });

  it('forgets notes on note-off and All Notes Off', () => {
    const t = new ActiveNoteTracker();
    t.handle(ev(noteOn(60)));
    t.handle(ev(noteOn(61)));
    t.handle(ev(noteOn(62, 1, 3)));
    t.handle(ev(noteOff(60)));
    t.handle(ev(cc(123, 0)));
    t.handle(ev(cc(7, 100)));
    t.handle(ev({ type: 'clock' }));
    expect(t.releaseAll().map((r) => r.message.note)).toEqual([62]);
  });

  it('tracks sustain pedals and releases them as CC64 = 0', () => {
    const t = new ActiveNoteTracker();
    t.handle(ev(cc(64, 127), { portId: 'z', portName: 'Z', profileId: 'p' }));
    t.handle(ev(cc(64, 127, 2)));
    t.handle(ev(cc(64, 127, 3)));
    t.handle(ev(cc(64, 0, 3)));
    expect(t.releaseSustain('in-1')).toEqual([
      {
        portId: 'in-1',
        portName: 'Test Keys',
        message: { type: 'controlChange', channel: 2, controller: 64, value: 0 },
      },
    ]);
    expect(t.releaseSustain()).toEqual([
      {
        portId: 'z',
        portName: 'Z',
        profileId: 'p',
        message: { type: 'controlChange', channel: 1, controller: 64, value: 0 },
      },
    ]);
  });
});

describe('MidiClockGenerator (experimental)', () => {
  it('produces 24 pulses per quarter note', () => {
    const clock = new MidiClockGenerator({ bpm: 120, startTimeMs: 1000 });
    const pulses = clock.pulsesInWindow(1000, 1500);
    expect(MIDI_CLOCK_PPQN).toBe(24);
    expect(pulses).toHaveLength(24);
    expect(pulses[0]).toBe(1000);
    expect(pulses[1]).toBeCloseTo(1000 + 500 / 24);
    expect(clock.intervalAt(1200)).toBeCloseTo(500 / 24);
  });

  it('windows are half-open, contiguous and never before the start', () => {
    const clock = new MidiClockGenerator({ bpm: 133, startTimeMs: 50 });
    const all = clock.pulsesInWindow(0, 2000);
    const pieces = [
      ...clock.pulsesInWindow(0, 333.3),
      ...clock.pulsesInWindow(333.3, 1000),
      ...clock.pulsesInWindow(1000, 2000),
    ];
    expect(pieces).toEqual(all);
    expect(all[0]).toBe(50);
    expect(clock.pulsesInWindow(10, 10)).toEqual([]);
    expect(clock.pulsesInWindow(0, 49)).toEqual([]);
  });

  it('keeps phase continuity across tempo changes', () => {
    const clock = new MidiClockGenerator({ bpm: 120, startTimeMs: 0 });
    clock.setTempo(60, 500); // exactly pulse 24
    expect(clock.pulseAt(500)).toBeCloseTo(24);
    const pulses = clock.pulsesInWindow(450, 600);
    expect(pulses.filter((t) => t < 500)).toHaveLength(2); // pulses 22 and 23 on the 120-BPM grid
    expect(pulses).toContain(500);
    expect(pulses[pulses.length - 1]! - pulses[pulses.length - 2]!).toBeCloseTo(1000 / 24);
    expect(clock.timeOfPulse(25)).toBeCloseTo(500 + 1000 / 24);
    clock.setTempo(90, 500); // replaces the change at the same time
    expect(clock.intervalAt(700)).toBeCloseTo(60000 / (90 * 24));
    expect(() => clock.setTempo(100, 100)).toThrow(RangeError);
  });

  it('rejects invalid tempi', () => {
    expect(() => new MidiClockGenerator({ bpm: 0, startTimeMs: 0 })).toThrow(RangeError);
    expect(() => new MidiClockGenerator({ bpm: Number.POSITIVE_INFINITY, startTimeMs: 0 })).toThrow(
      RangeError,
    );
  });
});
