/// <reference types="vite/client" />
/**
 * Renders every sample project (projects/<genre>/<song>/<song>.studio) through the real Web
 * Audio engine and checks that the bounce is audible and does not clip.
 *
 * Opt-in because it renders ~30 full songs (several minutes):
 *   VITE_SAMPLES_RENDER=1 pnpm exec vitest run --project browser packages/studio-react/tests/sample-projects.browser.test.ts
 * Spec validity of every song is checked on each CI run by `pnpm samples -- --check`.
 */
import { createWebAudioBackendFactory } from '@studio/audio-web';
import { importProjectBundle } from '@studio/project-storage';
import { describe, expect, it } from 'vitest';

const bundles = import.meta.glob<string>('../../../projects/*/*/*.studio', {
  query: '?url',
  import: 'default',
});
const enabled = Boolean(import.meta.env.VITE_SAMPLES_RENDER);

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function rms(channels: readonly Float32Array[]): number {
  let sum = 0;
  let count = 0;
  for (const ch of channels) {
    for (const v of ch) sum += v * v;
    count += ch.length;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

describe.skipIf(!enabled)('sample projects render audibly without clipping', () => {
  it('finds all 30 sample bundles', () => {
    expect(Object.keys(bundles)).toHaveLength(30);
  });

  it.each(Object.keys(bundles).map((path) => [path.split('/').slice(-3, -1).join('/'), path]))(
    '%s',
    { timeout: 240_000 },
    async (_name, path) => {
      const url = await bundles[path]!();
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const imported = await importProjectBundle(bytes, { sha256 });
      if (!imported.ok) throw imported.error;
      const { project } = imported.value;
      const engine = createWebAudioBackendFactory().create({
        assets: { load: () => Promise.reject(new Error('sample projects have no audio assets')) },
      });
      try {
        await engine.loadProject({ project });
        const result = await engine.render({
          startTick: 0,
          endTick: project.loop.endTick,
          sampleRate: 44100,
          channelCount: 2,
          tailSeconds: 'auto',
          includeMetronome: false,
        });
        expect(result.peak, 'peak (linear)').toBeLessThan(1);
        expect(rms(result.pcm.channels), 'overall RMS').toBeGreaterThan(0.01);
      } finally {
        await engine.dispose();
      }
    },
  );
});
