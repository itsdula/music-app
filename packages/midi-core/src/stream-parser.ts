/**
 * Incremental parser for raw MIDI byte streams (serial/DIN, native USB bridges, files).
 * Web MIDI already delivers whole messages; native adapters (e.g. a Rust `midir` bridge
 * that forwards raw packets) can feed chunks here.
 *
 * Handles running status, system real-time bytes interleaved anywhere (including inside
 * other messages and SysEx), SysEx accumulation with a size limit, and recovers from
 * malformed input by reporting an error and resynchronising on the next status byte.
 */
import { err, type Result } from '@studio/domain';
import type { MidiMessage, MidiParseError } from './messages';
import {
  channelVoiceDataLength,
  isRealTimeStatus,
  parseMidiMessage,
  systemCommonDataLength,
} from './parse';

export type MidiStreamItem = Result<MidiMessage, MidiParseError>;

export interface MidiStreamParserOptions {
  /** Maximum SysEx size in bytes including F0/F7. Default 64 KiB. */
  readonly maxSysexBytes?: number;
}

export const DEFAULT_MAX_SYSEX_BYTES = 64 * 1024;

export class MidiStreamParser {
  private readonly maxSysexBytes: number;
  /** Running status (channel-voice only); 0 when none. */
  private runningStatus = 0;
  /** Bytes of the message being assembled (status first). */
  private pending: number[] = [];
  private expectedLength = 0;
  private sysex: number[] | null = null;
  /** True while discarding an oversized SysEx until its F7. */
  private discardingSysex = false;

  constructor(options: MidiStreamParserOptions = {}) {
    this.maxSysexBytes = Math.max(2, options.maxSysexBytes ?? DEFAULT_MAX_SYSEX_BYTES);
  }

  /** Feeds a chunk of bytes; returns every message (or error) completed by it, in order. */
  push(chunk: Uint8Array | readonly number[]): MidiStreamItem[] {
    const out: MidiStreamItem[] = [];
    for (const byte of chunk) this.pushByte(byte & 0xff, out);
    return out;
  }

  /** Drops any partial message and running status (e.g. after a port reconnect). */
  reset(): void {
    this.runningStatus = 0;
    this.pending = [];
    this.expectedLength = 0;
    this.sysex = null;
    this.discardingSysex = false;
  }

  private pushByte(byte: number, out: MidiStreamItem[]): void {
    if (isRealTimeStatus(byte)) {
      // Real-time bytes never disturb running status or a message in progress.
      out.push(parseMidiMessage(Uint8Array.of(byte)));
      return;
    }
    if (byte >= 0x80) {
      this.handleStatus(byte, out);
      return;
    }
    this.handleData(byte, out);
  }

  private handleStatus(byte: number, out: MidiStreamItem[]): void {
    if (byte === 0xf7) {
      if (this.discardingSysex) {
        this.discardingSysex = false;
        return;
      }
      if (this.sysex) {
        this.sysex.push(0xf7);
        out.push(parseMidiMessage(Uint8Array.from(this.sysex)));
        this.sysex = null;
        return;
      }
      this.flushIncomplete(out);
      out.push(parseMidiMessage(Uint8Array.of(0xf7)));
      return;
    }

    if (this.sysex || this.discardingSysex) {
      if (this.sysex) {
        out.push(
          err({
            code: 'unterminated-sysex',
            message: `SysEx interrupted by status byte 0x${byte.toString(16).toUpperCase()}`,
          }),
        );
      }
      this.sysex = null;
      this.discardingSysex = false;
    }
    this.flushIncomplete(out);

    if (byte === 0xf0) {
      this.runningStatus = 0;
      this.sysex = [0xf0];
      return;
    }
    if (byte < 0xf0) {
      this.runningStatus = byte;
      this.startMessage(byte, 1 + channelVoiceDataLength(byte), out);
      return;
    }
    // System common: cancels running status.
    this.runningStatus = 0;
    const dataLength = systemCommonDataLength(byte);
    if (dataLength === undefined) {
      out.push(parseMidiMessage(Uint8Array.of(byte)));
      return;
    }
    this.startMessage(byte, 1 + dataLength, out);
  }

  private handleData(byte: number, out: MidiStreamItem[]): void {
    if (this.discardingSysex) return;
    if (this.sysex) {
      if (this.sysex.length + 1 >= this.maxSysexBytes) {
        out.push(
          err({
            code: 'unterminated-sysex',
            message: `SysEx exceeded the ${this.maxSysexBytes}-byte limit and was discarded`,
          }),
        );
        this.sysex = null;
        this.discardingSysex = true;
        return;
      }
      this.sysex.push(byte);
      return;
    }
    if (this.pending.length === 0) {
      if (this.runningStatus === 0) {
        out.push(
          err({
            code: 'unexpected-data-byte',
            message: `Data byte 0x${byte.toString(16).toUpperCase().padStart(2, '0')} without a status byte`,
          }),
        );
        return;
      }
      this.startMessage(this.runningStatus, 1 + channelVoiceDataLength(this.runningStatus), out);
    }
    this.pending.push(byte);
    this.completeIfReady(out);
  }

  private startMessage(status: number, length: number, out: MidiStreamItem[]): void {
    this.pending = [status];
    this.expectedLength = length;
    this.completeIfReady(out);
  }

  private completeIfReady(out: MidiStreamItem[]): void {
    if (this.pending.length < this.expectedLength) return;
    out.push(parseMidiMessage(Uint8Array.from(this.pending)));
    this.pending = [];
    this.expectedLength = 0;
  }

  private flushIncomplete(out: MidiStreamItem[]): void {
    if (this.pending.length === 0) return;
    out.push(
      err({
        code: 'truncated',
        message: `Message with status 0x${(this.pending[0] ?? 0).toString(16).toUpperCase()} was interrupted after ${this.pending.length} of ${this.expectedLength} bytes`,
      }),
    );
    this.pending = [];
    this.expectedLength = 0;
  }
}
