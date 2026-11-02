/**
 * URLs inside the site. The site is served under a base path ('/nawa/' on GitHub Pages, '/'
 * in dev and e2e; see vite.config.ts), so every internal link and public asset is built from
 * import.meta.env.BASE_URL instead of a root-relative '/...' path.
 */
const BASE_URL = import.meta.env.BASE_URL;

/** Resolves a path under the site's base, e.g. `sitePath('screenshots/a.png')`. */
export function sitePath(path: string): string {
  return `${BASE_URL}${path.replace(/^\/+/, '')}`;
}

/** The Studio page (a directory index, so the trailing slash matters on static hosts). */
export const STUDIO_URL = sitePath('studio/');
