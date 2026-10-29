/**
 * Turns planned schedule segments (engine-core) into Web Audio events on a
 * ProjectGraph. Used unchanged by realtime playback (lookahead windows) and offline
 * rendering (chunks between suspend points).
 */
import type { TrackId } from '@studio/domain';
import {
  metronomeClicksInRange,
  segmentTimeAtTick,
  type ScheduleSegment,
  type TimelineAudioEvent,
  type TimelineNoteEvent,
} from '@studio/engine-core';
import type { AssetBufferStore } from '../assets';
import { LATE_NOTE_TOLERANCE_SECONDS } from '../constants';
import type { ProjectGraph } from '../graph/project-graph';
import type { TrackChannel } from '../graph/track-channel';
import type { EngineModel } from '../model';

export interface ScheduleOptions {
  /** Restrict to these tracks (default: every track). */
  readonly tracks?: Iterable<TrackId>;
  /** Treat every segment as a discontinuity for audio (start overlapping clips mid-way). */
  readonly forceOverlap?: boolean;
  /** Skip audio segments that already have a voice sounding at their start time. */
  readonly skipSounding?: boolean;
  readonly metronome: boolean;
  /** Events earlier than this engine time are late: notes are shifted or dropped, audio starts further in. */
  readonly earliestTime: number;
}

export interface ScheduleStats {
  notes: number;
  audio: number;
  clicks: number;
  lateDropped: number;
}

export class EventScheduler {
  constructor(
    private readonly graph: ProjectGraph,
    private readonly model: EngineModel,
    private readonly assets: AssetBufferStore,
  ) {}

  schedule(segments: readonly ScheduleSegment[], options: ScheduleOptions): ScheduleStats {
    const stats: ScheduleStats = { notes: 0, audio: 0, clicks: 0, lateDropped: 0 };
    const trackIds = options.tracks ? [...options.tracks] : [...this.model.tracks.keys()];
    for (const segment of segments) {
      for (const trackId of trackIds) {
        const channel = this.graph.channel(trackId);
        const timeline = this.model.timeline(trackId);
        if (!channel || !timeline) continue;
        this.scheduleNotes(
          segment,
          channel,
          timeline.notesStartingIn(segment.startTick, segment.endTick),
          options,
          stats,
        );
        const audio =
          segment.discontinuity || options.forceOverlap
            ? timeline.audioOverlapping(segment.startTick, segment.endTick)
            : timeline.audioStartingIn(segment.startTick, segment.endTick);
        for (const event of audio) this.scheduleAudio(segment, channel, event, options, stats);
      }
      if (options.metronome) {
        for (const click of metronomeClicksInRange(
          segment.startTick,
          segment.endTick,
          this.model.meter,
        )) {
          const time = segmentTimeAtTick(segment, click.tick);
          if (time < options.earliestTime) continue;
          this.graph.metronome.click(time, click.accent);
          stats.clicks++;
        }
      }
    }
    return stats;
  }

  private scheduleNotes(
    segment: ScheduleSegment,
    channel: TrackChannel,
    notes: readonly TimelineNoteEvent[],
    options: ScheduleOptions,
    stats: ScheduleStats,
  ): void {
    const instrument = channel.instrumentNode;
    if (!instrument || notes.length === 0) return;
    for (const note of notes) {
      let onTime = segmentTimeAtTick(segment, note.startTick);
      const offTick = Math.min(note.endTick, segment.boundaryTick);
      const offTime = segmentTimeAtTick(segment, offTick);
      if (onTime < options.earliestTime) {
        if (
          options.earliestTime - onTime > LATE_NOTE_TOLERANCE_SECONDS ||
          offTime <= options.earliestTime
        ) {
          stats.lateDropped++;
          continue;
        }
        onTime = options.earliestTime;
      }
      instrument.scheduleNote({
        pitch: note.pitch,
        velocity: note.velocity,
        onTime,
        offTime: Math.max(offTime, onTime),
        clipId: note.clipId,
      });
      stats.notes++;
    }
  }

  private scheduleAudio(
    segment: ScheduleSegment,
    channel: TrackChannel,
    event: TimelineAudioEvent,
    options: ScheduleOptions,
    stats: ScheduleStats,
  ): void {
    const buffer = this.assets.get(event.assetId);
    if (!buffer) return;
    const fromTick = Math.max(event.startTick, segment.startTick);
    const toTick = Math.min(event.endTick, segment.boundaryTick);
    if (!(toTick > fromTick)) return;
    let when = segmentTimeAtTick(segment, fromTick);
    const until = segmentTimeAtTick(segment, toTick);
    const eventStartTime = segmentTimeAtTick(segment, event.startTick);
    if (when < options.earliestTime) when = options.earliestTime;
    if (!(until > when)) {
      stats.lateDropped++;
      return;
    }
    if (options.skipSounding && channel.hasAudioVoice(event.key, when)) return;
    const rate = event.sampleRate;
    const offsetFrames = Math.max(0, Math.round((when - eventStartTime) * rate));
    const playFrames = Math.min(event.frames - offsetFrames, Math.round((until - when) * rate));
    if (playFrames <= 0) return;
    channel.playAudio({
      event,
      buffer,
      when,
      offsetFrames,
      playFrames,
      endsEarly: offsetFrames + playFrames < event.frames,
    });
    stats.audio++;
  }
}
