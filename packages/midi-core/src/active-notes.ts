/**
 * Tracks which notes are sounding per port and channel so they can be released when the
 * user hits panic, a device disconnects, or the transport stops (no stuck notes).
 */
import { CC, type MidiMessage } from './messages';
import type { MidiInputEvent } from './types';

type NoteOff = Extract<MidiMessage, { type: 'noteOff' }>;
type SustainOff = Extract<MidiMessage, { type: 'controlChange' }>;

/** A synthetic release for a tracked note or pedal, with the origin of the original. */
export interface ActiveNoteRelease<M extends MidiMessage = NoteOff> {
  readonly portId: string;
  readonly portName: string;
  readonly profileId?: string;
  readonly message: M;
}

interface Origin {
  readonly portId: string;
  readonly portName: string;
  readonly profileId?: string;
}

const noteKey = (portId: string, channel: number, note: number): string =>
  `${portId}\u0000${channel}\u0000${note}`;
const channelKey = (portId: string, channel: number): string => `${portId}\u0000${channel}`;

export class ActiveNoteTracker {
  private readonly notes = new Map<string, Origin & { channel: number; note: number }>();
  private readonly pedals = new Map<string, Origin & { channel: number }>();

  /** Updates tracking from a validated input event. */
  handle(event: MidiInputEvent): void {
    const message = event.message;
    const origin: Origin = {
      portId: event.portId,
      portName: event.portName,
      ...(event.profileId !== undefined ? { profileId: event.profileId } : {}),
    };
    switch (message.type) {
      case 'noteOn':
        this.notes.set(noteKey(event.portId, message.channel, message.note), {
          ...origin,
          channel: message.channel,
          note: message.note,
        });
        return;
      case 'noteOff':
        this.notes.delete(noteKey(event.portId, message.channel, message.note));
        return;
      case 'controlChange':
        if (message.controller === CC.sustain) {
          const k = channelKey(event.portId, message.channel);
          if (message.value >= 64) this.pedals.set(k, { ...origin, channel: message.channel });
          else this.pedals.delete(k);
        } else if (message.controller === CC.allNotesOff || message.controller === CC.allSoundOff) {
          this.removeWhere(
            this.notes,
            (n) => n.portId === event.portId && n.channel === message.channel,
          );
        }
        return;
      default:
        return;
    }
  }

  isActive(portId: string, channel: number, note: number): boolean {
    return this.notes.has(noteKey(portId, channel, note));
  }

  /** Number of sounding notes, optionally for one port. */
  activeCount(portId?: string): number {
    if (portId === undefined) return this.notes.size;
    let count = 0;
    for (const n of this.notes.values()) if (n.portId === portId) count++;
    return count;
  }

  /**
   * Forgets all tracked notes (of one port, or all) and returns a synthetic noteOff
   * (velocity 0) for each, ordered by port, channel and note.
   */
  releaseAll(portId?: string): ActiveNoteRelease[] {
    const released = this.removeWhere(
      this.notes,
      (n) => portId === undefined || n.portId === portId,
    );
    return released
      .sort((a, b) => cmp(a.portId, b.portId) || a.channel - b.channel || a.note - b.note)
      .map((n) => ({
        ...origin(n),
        message: { type: 'noteOff', channel: n.channel, note: n.note, velocity: 0 },
      }));
  }

  /** Forgets held sustain pedals and returns synthetic CC64 = 0 messages for them. */
  releaseSustain(portId?: string): ActiveNoteRelease<SustainOff>[] {
    const released = this.removeWhere(
      this.pedals,
      (p) => portId === undefined || p.portId === portId,
    );
    return released
      .sort((a, b) => cmp(a.portId, b.portId) || a.channel - b.channel)
      .map((p) => ({
        ...origin(p),
        message: { type: 'controlChange', channel: p.channel, controller: CC.sustain, value: 0 },
      }));
  }

  private removeWhere<T>(map: Map<string, T>, predicate: (value: T) => boolean): T[] {
    const removed: T[] = [];
    for (const [k, v] of map) {
      if (!predicate(v)) continue;
      map.delete(k);
      removed.push(v);
    }
    return removed;
  }
}

function origin(o: Origin): Origin {
  return {
    portId: o.portId,
    portName: o.portName,
    ...(o.profileId !== undefined ? { profileId: o.profileId } : {}),
  };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
