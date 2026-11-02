/**
 * Build-time constants injected by scripts/build.mjs (esbuild `define` for main, Vite `define`
 * for the renderer) from the environment of the build:
 *   STUDIO_ASSISTANT_URL    absolute URL of a Studio `/api/assistant` endpoint, e.g.
 *                           https://studio.example.com/api/assistant ('' = no assistant)
 *   STUDIO_ASSISTANT_TOKEN  optional shared secret matching the server's STUDIO_ASSISTANT_TOKEN
 *                           (renderer only; visible to anyone who unpacks the app)
 *   STUDIO_DEV=1            `__STUDIO_DEV__` = true: compiles in the dev-only code used by
 *                           `pnpm dev` (main: OpenTelemetry log export and window reload;
 *                           renderer: info/debug logs on the console). `false` in every other
 *                           build, so the shipped bundles contain none of it.
 * Read them with a `typeof` guard so unbundled code (tests) does not throw.
 */
declare const __STUDIO_ASSISTANT_URL__: string | undefined;
declare const __STUDIO_ASSISTANT_TOKEN__: string | undefined;
declare const __STUDIO_DEV__: boolean | undefined;
