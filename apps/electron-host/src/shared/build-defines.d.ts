/**
 * Build-time constants injected by scripts/build.mjs (esbuild `define` for main, Vite `define`
 * for the renderer) from the environment of the build:
 *   STUDIO_ASSISTANT_URL    absolute URL of a Studio `/api/assistant` endpoint, e.g.
 *                           https://studio.example.com/api/assistant ('' = no assistant)
 *   STUDIO_ASSISTANT_TOKEN  optional shared secret matching the server's STUDIO_ASSISTANT_TOKEN
 *                           (renderer only; visible to anyone who unpacks the app)
 * Read them with a `typeof` guard so unbundled code (tests) does not throw.
 */
declare const __STUDIO_ASSISTANT_URL__: string | undefined;
declare const __STUDIO_ASSISTANT_TOKEN__: string | undefined;
