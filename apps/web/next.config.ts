import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source ("internal packages").
  transpilePackages: [
    '@studio/react',
    '@studio/ui',
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
};

export default nextConfig;
