/**
 * MIDI beat clock (24 pulses per quarter note) timestamp generator.
 *
 * @experimental Pure scheduling math only. Whether a given device (e.g. the MPK Mini MK3
 * arpeggiator with Clock Source = External) follows Studio's clock has not been verified
 * on hardware, and Web MIDI send-timestamp accuracy has not been measured. The caller
 * schedules the returned timestamps with `MidiAccessPort.send(port, [0xF8], timestamp)`
 * in a look-ahead loop and sends Start/Stop/Continue itself.
 */

export const MIDI_CLOCK_PPQN = 24;

export interface MidiClockGeneratorOptions {
  readonly bpm: number;
  /** Host time (ms) of pulse 0 — normally the transport start time. */
  readonly startTimeMs: number;
}

interface Segment {
  readonly timeMs: number;
  /** Fractional pulse position at `timeMs`. */
  readonly pulse: number;
  readonly intervalMs: number;
}

function intervalFor(bpm: number): number {
  if (!(bpm > 0) || !Number.isFinite(bpm)) {
    throw new RangeError(`MIDI clock tempo must be a positive finite BPM, got ${bpm}`);
  }
  return 60_000 / (bpm * MIDI_CLOCK_PPQN);
}

/** @experimental See module documentation. */
export class MidiClockGenerator {
  private segments: Segment[];

  constructor(options: MidiClockGeneratorOptions) {
    this.segments = [
      { timeMs: options.startTimeMs, pulse: 0, intervalMs: intervalFor(options.bpm) },
    ];
  }

  /** Milliseconds between pulses at the tempo in effect at `timeMs`. */
  intervalAt(timeMs: number): number {
    return this.segmentAt(timeMs).intervalMs;
  }

  /**
   * Changes tempo from `atTimeMs` on (must not precede the last change). Pulse phase is
   * continuous: pulses already due before `atTimeMs` are unaffected.
   */
  setTempo(bpm: number, atTimeMs: number): void {
    const last = this.segments[this.segments.length - 1] as Segment;
    if (atTimeMs < last.timeMs) {
      throw new RangeError('MIDI clock tempo changes must be added in time order');
    }
    const pulse = this.pulseAt(atTimeMs);
    const segment = { timeMs: atTimeMs, pulse, intervalMs: intervalFor(bpm) };
    if (atTimeMs === last.timeMs) this.segments[this.segments.length - 1] = segment;
    else this.segments.push(segment);
  }

  /** Fractional pulse position at a host time (negative before the start). */
  pulseAt(timeMs: number): number {
    const segment = this.segmentAt(timeMs);
    return segment.pulse + (timeMs - segment.timeMs) / segment.intervalMs;
  }

  /** Host time of an integer pulse index. */
  timeOfPulse(pulse: number): number {
    let segment = this.segments[0] as Segment;
    for (const candidate of this.segments) {
      if (candidate.pulse <= pulse) segment = candidate;
      else break;
    }
    return segment.timeMs + (pulse - segment.pulse) * segment.intervalMs;
  }

  /**
   * Timestamps (ms) of every clock pulse with index >= 0 in the half-open window
   * [fromMs, toMs), in ascending order.
   */
  pulsesInWindow(fromMs: number, toMs: number): number[] {
    const out: number[] = [];
    if (!(toMs > fromMs)) return out;
    let pulse = Math.max(0, Math.ceil(this.pulseAt(fromMs) - 1e-9));
    for (;;) {
      const time = this.timeOfPulse(pulse);
      if (time >= toMs) break;
      if (time >= fromMs - 1e-9) out.push(time);
      pulse++;
    }
    return out;
  }

  private segmentAt(timeMs: number): Segment {
    let segment = this.segments[0] as Segment;
    for (const candidate of this.segments) {
      if (candidate.timeMs <= timeMs) segment = candidate;
      else break;
    }
    return segment;
  }
}
