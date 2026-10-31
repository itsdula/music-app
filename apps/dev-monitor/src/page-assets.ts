/** Bundles the monitor page (React) in memory with esbuild when the orchestrator starts. */
import { join } from 'node:path';
import { build } from 'esbuild';
import type { PageAssets } from './server';

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>Studio dev monitor</title>
    <link rel="stylesheet" href="/assets/monitor.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/monitor.js"></script>
  </body>
</html>
`;

export async function buildPageAssets(appDir: string): Promise<PageAssets> {
  const result = await build({
    entryPoints: [join(appDir, 'src/page/main.tsx')],
    bundle: true,
    write: false,
    outdir: '/assets',
    entryNames: 'monitor',
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
    jsx: 'automatic',
    minify: true,
    legalComments: 'none',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  let js = '';
  let css = '';
  for (const file of result.outputFiles) {
    if (file.path.endsWith('.js')) js = file.text;
    else if (file.path.endsWith('.css')) css = file.text;
  }
  return { html: HTML, js, css };
}
