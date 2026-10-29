/**
 * Records note input into tick-based notes.
 *
 * Time model: events carry host timestamps (ms, `performance.now()` domain in browsers);
 * the injected `tickAt` converts them to project ticks (the app accounts for transport
 * start, tempo map and any input-latency compensation there). Ticks are rounded to
 * integers and every note lasts at least 1 tick.
 */
import { CC } from './messages';
import type { MidiInputEvent } from './types';

export interface RecordedMidiNote {
  readonly pitch: number;
  readonly velocity: number;
  readonly startTick: number;
  readonly durationTicks: number;
  readonly channel: number;
}

export interface RecorderClock {
  tickAt(timestampMs: number): number;
}

interface OpenNote {
  readonly pitch: number;
  readonly velocity: number;
  readonly channel: number;
  readonly startTick: number;
}

const key = (channel: number, pitch: number): string => `${channel}:${pitch}`;

export class MidiNoteRecorder {
  /** Notes whose key is still held. */
  private readonly held = new Map<string, OpenNote>();
  /** Notes released while the sustain pedal was down; they end at pedal-up. */
  private readonly sustained = new Map<string, OpenNote>();
  private readonly pedalDown = new Set<number>();
  private notes: RecordedMidiNote[] = [];

  constructor(private readonly clock: RecorderClock) {}

  handle(event: MidiInputEvent): void {
    const message = event.message;
    switch (message.type) {
      case 'noteOn': {
        const tick = this.tickAt(event.timestampMs);
        const k = key(message.channel, message.note);
        // A re-triggered pitch closes the previous instance (held or sustained).
        this.closeFrom(this.held, k, tick);
        this.closeFrom(this.sustained, k, tick);
        this.held.set(k, {
          pitch: message.note,
          velocity: message.velocity,
          channel: message.channel,
          startTick: tick,
        });
        return;
      }
      case 'noteOff': {
        const k = key(message.channel, message.note);
        const note = this.held.get(k);
        if (!note) return;
        this.held.delete(k);
        if (this.pedalDown.has(message.channel)) {
          this.sustained.set(k, note);
        } else {
          this.close(note, this.tickAt(event.timestampMs));
        }
        return;
      }
      case 'controlChange': {
        if (message.controller === CC.sustain) {
          if (message.value >= 64) {
            this.pedalDown.add(message.channel);
          } else if (this.pedalDown.delete(message.channel)) {
            this.closeChannel(this.sustained, message.channel, this.tickAt(event.timestampMs));
          }
        } else if (message.controller === CC.allNotesOff || message.controller === CC.allSoundOff) {
          const tick = this.tickAt(event.timestampMs);
          this.pedalDown.delete(message.channel);
          this.closeChannel(this.held, message.channel, tick);
          this.closeChannel(this.sustained, message.channel, tick);
        }
        return;
      }
      default:
        return;
    }
  }

  /** Number of notes still sounding (held or sustained). */
  get openCount(): number {
    return this.held.size + this.sustained.size;
  }

  /**
   * Closes every still-sounding note at `endTick` and returns all recorded notes sorted by
   * start tick, then pitch. The recorder is reset afterwards and can be reused.
   */
  finish(endTick: number): RecordedMidiNote[] {
    const end = Math.round(endTick);
    for (const note of this.held.values()) this.close(note, end);
    for (const note of this.sustained.values()) this.close(note, end);
    const result = this.notes.sort(
      (a, b) => a.startTick - b.startTick || a.pitch - b.pitch || a.channel - b.channel,
    );
    this.reset();
    return result;
  }

  /** Discards everything recorded so far. */
  reset(): void {
    this.held.clear();
    this.sustained.clear();
    this.pedalDown.clear();
    this.notes = [];
  }

  private tickAt(timestampMs: number): number {
    return Math.round(this.clock.tickAt(timestampMs));
  }

  private closeFrom(map: Map<string, OpenNote>, k: string, tick: number): void {
    const note = map.get(k);
    if (!note) return;
    map.delete(k);
    this.close(note, tick);
  }

  private closeChannel(map: Map<string, OpenNote>, channel: number, tick: number): void {
    for (const [k, note] of map) {
      if (note.channel !== channel) continue;
      map.delete(k);
      this.close(note, tick);
    }
  }

  private close(note: OpenNote, endTick: number): void {
    this.notes.push({
      pitch: note.pitch,
      velocity: note.velocity,
      startTick: note.startTick,
      durationTicks: Math.max(1, endTick - note.startTick),
      channel: note.channel,
    });
  }
}
