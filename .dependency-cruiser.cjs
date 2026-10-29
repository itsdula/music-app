/**
 * Package boundary rules (see docs/architecture.md §Boundaries).
 *
 * Classes:
 *   A portable cores  — pure TS, Rust-port candidates, no React/Next/DOM/host packages
 *   B host adapters   — browser/Electron/Tauri APIs (audio-web, platform-browser)
 *   C UI              — React (ui, studio-react)
 *   hosts             — apps/*
 */
const PORTABLE = [
  'domain',
  'commands',
  'engine-core',
  'audio-contracts',
  'audio-dsp',
  'vocal-dsp',
  'midi-core',
  'midi-akai-mpk-mini-mk3',
  'project-storage',
  'platform-contracts',
  'test-fixtures',
].join('|');

const portableSrc = `^packages/(${PORTABLE})/src/`;

/** Allowed workspace dependencies per package (by directory). */
const ALLOWED = {
  domain: [],
  commands: ['domain'],
  'engine-core': ['domain', 'audio-contracts', 'audio-dsp'],
  'audio-contracts': ['domain', 'audio-dsp'],
  'audio-dsp': [],
  'vocal-dsp': ['domain', 'audio-dsp'],
  'midi-core': ['domain'],
  'midi-akai-mpk-mini-mk3': ['domain', 'midi-core'],
  'project-storage': ['domain'],
  'platform-contracts': [
    'domain',
    'audio-contracts',
    'audio-dsp',
    'project-storage',
    'midi-core',
    'vocal-dsp',
  ],
  'test-fixtures': ['domain', 'audio-dsp'],
  'audio-web': ['domain', 'audio-contracts', 'audio-dsp', 'engine-core', 'vocal-dsp'],
  'platform-browser': [
    'domain',
    'audio-contracts',
    'audio-dsp',
    'audio-web',
    'midi-core',
    'project-storage',
    'platform-contracts',
    'vocal-dsp',
  ],
  ui: [],
  'studio-react': [
    'domain',
    'commands',
    'engine-core',
    'audio-contracts',
    'audio-dsp',
    'vocal-dsp',
    'midi-core',
    'midi-akai-mpk-mini-mk3',
    'project-storage',
    'platform-contracts',
    'platform-browser',
    'ui',
  ],
};

const packageRules = Object.entries(ALLOWED).map(([pkg, allowed]) => ({
  name: `allowed-deps-${pkg}`,
  severity: 'error',
  comment: `${pkg} may only depend on: ${allowed.join(', ') || '(no workspace packages)'}`,
  from: { path: `^packages/${pkg}/src/` },
  to: {
    path: '^packages/([^/]+)/src/',
    pathNot: [`^packages/(${[pkg, ...allowed].join('|')})/src/`],
  },
}));

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies hide coupling and break incremental ports.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'portable-no-frameworks',
      severity: 'error',
      comment: 'Portable cores must not depend on React, Next.js, Zustand, Dexie or UI libraries.',
      from: { path: portableSrc },
      to: {
        path: 'node_modules/(react|react-dom|next|zustand|dexie|radix-ui|@radix-ui|lucide-react)/',
      },
    },
    {
      name: 'portable-no-node-builtins',
      severity: 'error',
      comment: 'Portable cores must not use Node built-ins (tests may).',
      from: { path: portableSrc },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'only-web-app-imports-next',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: 'node_modules/next/' },
    },
    {
      name: 'studio-react-platform-browser-only-in-default-platform',
      severity: 'error',
      comment:
        'Features depend on PlatformServices; only the default-platform module wires browser adapters.',
      from: {
        path: '^packages/studio-react/src/',
        pathNot: '^packages/studio-react/src/platform/default-platform\\.ts$',
      },
      to: { path: '^packages/platform-browser/' },
    },
    {
      name: 'apps-only-public-entry-points',
      severity: 'error',
      comment: 'Hosts mount <Studio /> and may use @studio/ui; everything else is internal.',
      from: { path: '^apps/' },
      to: {
        path: '^packages/',
        pathNot: ['^packages/(studio-react|ui)/', '^packages/platform-browser/'],
      },
    },
    ...packageRules,
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: ['(^|/)(dist|\\.next|coverage|\\.turbo)/', '(^|/)src/generated/', '\\.claude/'],
    },
    includeOnly: [
      '^packages/',
      '^apps/',
      'node_modules/(react|react-dom|next|zustand|dexie|radix-ui|@radix-ui|lucide-react)/',
    ],
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.d.ts'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
