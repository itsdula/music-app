/**
 * Offline bounce to WAV through the engine's render path (same graph as playback).
 */
import type { AudioEngine, RenderProgress } from '@studio/audio-contracts';
import { encodeWav } from '@studio/audio-dsp';
import { arrangementEndTick, type Project } from '@studio/domain';
import type { FileDialogs } from '@studio/platform-contracts';

export type ExportRange = 'arrangement' | 'loop';

export interface ExportOptions {
  readonly range: ExportRange;
  readonly sampleRate: 44100 | 48000;
  readonly bitDepth: 16 | 24 | 32;
  readonly includeTail: boolean;
}

export interface ExportResult {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly durationSeconds: number;
  readonly peak: number;
  readonly saved: boolean;
}

export function exportRangeTicks(
  project: Project,
  range: ExportRange,
): { startTick: number; endTick: number } | null {
  if (range === 'loop') {
    return project.loop.endTick > project.loop.startTick
      ? { startTick: project.loop.startTick, endTick: project.loop.endTick }
      : null;
  }
  const end = Math.ceil(arrangementEndTick(project));
  return end > 0 ? { startTick: 0, endTick: end } : null;
}

export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'Nawa Export';
}

export class ExportController {
  constructor(
    private readonly engine: AudioEngine,
    private readonly fileDialogs: FileDialogs,
  ) {}

  async exportWav(
    project: Project,
    options: ExportOptions,
    hooks: { signal?: AbortSignal; onProgress?: (p: RenderProgress) => void; save?: boolean } = {},
  ): Promise<ExportResult> {
    const range = exportRangeTicks(project, options.range);
    if (!range)
      throw new Error(
        options.range === 'loop'
          ? 'The loop region is empty.'
          : 'The arrangement is empty — add a clip first.',
      );
    const rendered = await this.engine.render(
      {
        startTick: range.startTick,
        endTick: range.endTick,
        sampleRate: options.sampleRate,
        channelCount: 2,
        tailSeconds: options.includeTail ? 'auto' : 0,
        includeMetronome: false,
      },
      {
        ...(hooks.signal ? { signal: hooks.signal } : {}),
        ...(hooks.onProgress ? { onProgress: hooks.onProgress } : {}),
      },
    );
    const bytes = encodeWav(
      rendered.pcm,
      options.bitDepth === 32
        ? { bitDepth: 32 }
        : { bitDepth: options.bitDepth, dither: 'tpdf', seed: 1 },
    );
    const fileName = `${safeFileName(project.name)}.wav`;
    const frames = rendered.pcm.channels[0]?.length ?? 0;
    const saved =
      hooks.save === false
        ? false
        : await this.fileDialogs.saveFile(bytes, {
            suggestedName: fileName,
            mimeType: 'audio/wav',
          });
    return {
      bytes,
      fileName,
      durationSeconds: frames / rendered.pcm.sampleRate,
      peak: rendered.peak,
      saved,
    };
  }
}
