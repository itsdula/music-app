/**
 * Human-readable, sanitized descriptions for the MIDI diagnostics view. Output is plain
 * text built only from validated numeric fields: SysEx payloads are truncated and raw
 * objects are never dumped.
 */
import { midiToNoteName } from '@studio/domain';
import type { MidiMessage } from './messages';

const DEFAULT_MAX_BYTES = 16;
const SYSEX_PREVIEW_BYTES = 8;

/**
 * Formats bytes as uppercase hex pairs, e.g. "90 3C 64". Longer inputs are truncated to
 * `maxBytes` with a "… (+N bytes)" suffix.
 */
export function formatMidiBytes(bytes: Uint8Array, maxBytes: number = DEFAULT_MAX_BYTES): string {
  const limit = Math.max(0, Math.floor(maxBytes));
  const shown = Array.from(bytes.subarray(0, limit), (byte) =>
    byte.toString(16).toUpperCase().padStart(2, '0'),
  ).join(' ');
  const hidden = bytes.length - Math.min(bytes.length, limit);
  if (hidden <= 0) return shown;
  return `${shown}${shown ? ' ' : ''}… (+${hidden} byte${hidden === 1 ? '' : 's'})`;
}

const noteLabel = (note: number): string => `${midiToNoteName(note)} (${note})`;

/** One-line description, e.g. "Note On ch 1 C4 (60) vel 100". */
export function describeMidiMessage(message: MidiMessage): string {
  switch (message.type) {
    case 'noteOn':
      return `Note On ch ${message.channel} ${noteLabel(message.note)} vel ${message.velocity}`;
    case 'noteOff':
      return `Note Off ch ${message.channel} ${noteLabel(message.note)} vel ${message.velocity}`;
    case 'polyPressure':
      return `Poly Aftertouch ch ${message.channel} ${noteLabel(message.note)} = ${message.pressure}`;
    case 'controlChange':
      return `CC ch ${message.channel} #${message.controller} = ${message.value}`;
    case 'programChange':
      return `Program Change ch ${message.channel} program ${message.program}`;
    case 'channelPressure':
      return `Channel Aftertouch ch ${message.channel} = ${message.pressure}`;
    case 'pitchBend':
      return `Pitch Bend ch ${message.channel} ${message.value > 0 ? '+' : ''}${message.value}`;
    case 'sysex':
      return `SysEx ${message.bytes.length} bytes [${formatMidiBytes(message.bytes, SYSEX_PREVIEW_BYTES)}]`;
    case 'mtcQuarterFrame':
      return `MTC Quarter Frame ${message.value}`;
    case 'songPosition':
      return `Song Position ${message.sixteenths} sixteenths`;
    case 'songSelect':
      return `Song Select ${message.song}`;
    case 'tuneRequest':
      return 'Tune Request';
    case 'clock':
      return 'Clock';
    case 'start':
      return 'Start';
    case 'continue':
      return 'Continue';
    case 'stop':
      return 'Stop';
    case 'activeSensing':
      return 'Active Sensing';
    case 'systemReset':
      return 'System Reset';
  }
}
