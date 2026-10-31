import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source ("internal packages").
  transpilePackages: [
    '@studio/react',
    '@studio/ui',
    '@studio/audio-ui',
    '@studio/domain',
    '@studio/commands',
    '@studio/engine-core',
    '@studio/audio-contracts',
    '@studio/audio-dsp',
    '@studio/vocal-dsp',
    '@studio/midi-core',
    '@studio/midi-akai-mpk-mini-mk3',
    '@studio/project-storage',
    '@studio/platform-contracts',
    '@studio/assistant-core',
    '@studio/platform-browser',
    '@studio/audio-web',
  ],
  poweredByHeader: false,
  // `pnpm dev` (apps/dev-monitor, STUDIO_DEV=1): forward every browser console message of the
  // pages to the `next dev` terminal as `[browser] ...`, where the dev monitor picks it up.
  // Other runs keep Next's default (warnings and errors).
  ...(process.env.STUDIO_DEV === '1' ? { logging: { browserToTerminal: true } } : {}),
};

export default nextConfig;
