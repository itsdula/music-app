/**
 * Offline bounce: the same ProjectGraph and EventScheduler as realtime playback, built
 * on an OfflineAudioContext. Events are scheduled chunk by chunk at suspend points
 * (keeping the number of live nodes bounded); the AbortSignal is checked at every
 * suspend point and progress is reported there.
 */
import type {
  AbortSignalLike,
  EngineLogger,
  RenderProgress,
  RenderRequest,
  RenderedAudio,
} from '@studio/audio-contracts';
import { peakAmplitude } from '@studio/audio-dsp';
import { ticksToSeconds } from '@studio/domain';
import {
  createTransportClock,
  estimateTailSeconds,
  planScheduleSegments,
  unwrappedTickAtTime,
} from '@studio/engine-core';
import { audioBufferToPcm, type AssetBufferStore } from './assets';
import { MAX_RENDER_SECONDS, RENDER_CHUNK_SECONDS, RENDER_LEAD_SECONDS } from './constants';
import { AudioEngineError, describeError } from './errors';
import { createGraphContext } from './graph/graph-context';
import { ProjectGraph } from './graph/project-graph';
import type { EngineModel } from './model';
import { EventScheduler } from './scheduler/event-scheduler';

export interface OfflineRenderInput {
  /** Snapshot of the state to render (not mutated). */
  readonly model: EngineModel;
  readonly assets: AssetBufferStore;
  readonly logger: EngineLogger;
  readonly request: RenderRequest;
  readonly signal?: AbortSignalLike;
  readonly onProgress?: (progress: RenderProgress) => void;
}

function cancelled(): AudioEngineError {
  return new AudioEngineError('render-cancelled', 'Render was cancelled');
}

/** Validates a request and returns (durationSeconds, tailSeconds). */
export function planRender(
  model: EngineModel,
  request: RenderRequest,
): { duration: number; tail: number } {
  if (!(request.endTick > request.startTick)) {
    throw new AudioEngineError(
      'render-failed',
      'Render range is empty (endTick must exceed startTick)',
    );
  }
  if (request.sampleRate !== 44100 && request.sampleRate !== 48000) {
    throw new AudioEngineError(
      'render-failed',
      `Unsupported render sample rate ${String(request.sampleRate)}`,
    );
  }
  if (request.channelCount !== 1 && request.channelCount !== 2) {
    throw new AudioEngineError(
      'render-failed',
      `Unsupported channel count ${String(request.channelCount)}`,
    );
  }
  const duration = ticksToSeconds(request.endTick - request.startTick, model.bpm);
  const tail =
    request.tailSeconds === 'auto'
      ? estimateTailSeconds({ tracks: model.orderedTracks(), master: model.master })
      : Math.max(0, request.tailSeconds);
  if (duration + tail > MAX_RENDER_SECONDS) {
    throw new AudioEngineError(
      'render-failed',
      `Render longer than ${MAX_RENDER_SECONDS} s is not supported`,
    );
  }
  return { duration, tail };
}

export async function renderOffline(input: OfflineRenderInput): Promise<RenderedAudio> {
  const { model, assets, request, signal, onProgress, logger } = input;
  if (signal?.aborted) throw cancelled();
  const { duration, tail } = planRender(model, request);
  await Promise.all([...model.referencedAssets()].map((id) => assets.ensure(id)));
  if (signal?.aborted) throw cancelled();

  const total = duration + tail;
  const ctx = new OfflineAudioContext({
    numberOfChannels: request.channelCount,
    length: Math.max(1, Math.ceil(total * request.sampleRate)),
    sampleRate: request.sampleRate,
  });
  const g = createGraphContext({ ctx, realtime: false, logger, assets, workletReady: false });
  const graph = new ProjectGraph(g, {
    tracks: model.orderedTracks(),
    master: model.master,
    metronome: model.metronome,
    meters: false,
  });
  const scheduler = new EventScheduler(graph, model, assets);
  const clock = createTransportClock(0, request.startTick, model.bpm, null);
  let scheduledU = request.startTick;
  const scheduleUntil = (seconds: number, first: boolean) => {
    const to = Math.min(unwrappedTickAtTime(clock, seconds), request.endTick);
    if (!(to > scheduledU)) return;
    const segments = planScheduleSegments(clock, scheduledU, to, {
      startIsDiscontinuity: first,
      endTick: request.endTick,
    });
    scheduler.schedule(segments, { metronome: request.includeMetronome, earliestTime: 0 });
    scheduledU = to;
  };
  scheduleUntil(RENDER_CHUNK_SECONDS + RENDER_LEAD_SECONDS, true);

  let aborted = false;
  let rejectAbort: ((error: Error) => void) | null = null;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    aborted = true;
    rejectAbort?.(cancelled());
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  for (let t = RENDER_CHUNK_SECONDS; t < duration; t += RENDER_CHUNK_SECONDS) {
    const at = t;
    ctx
      .suspend(at)
      .then(() => {
        if (aborted || signal?.aborted) {
          // Leave the context suspended: the render never completes and is collected.
          onAbort();
          return;
        }
        onProgress?.({ fraction: Math.min(1, at / total) });
        scheduleUntil(at + RENDER_CHUNK_SECONDS + RENDER_LEAD_SECONDS, false);
        return ctx.resume();
      })
      .catch((error: unknown) =>
        logger.warn('render suspend failed', { error: describeError(error) }),
      );
  }

  try {
    const buffer = await Promise.race([ctx.startRendering(), abortPromise]);
    const pcm = audioBufferToPcm(buffer);
    onProgress?.({ fraction: 1 });
    return {
      pcm,
      startTick: request.startTick,
      endTick: request.endTick,
      tailSeconds: tail,
      peak: peakAmplitude(pcm),
    };
  } catch (error) {
    if (error instanceof AudioEngineError) throw error;
    throw new AudioEngineError('render-failed', 'Offline render failed', describeError(error));
  } finally {
    signal?.removeEventListener('abort', onAbort);
    graph.dispose();
    g.dispose();
  }
}
