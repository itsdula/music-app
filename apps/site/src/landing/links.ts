/** External links used across the landing page. */
export const GITHUB_URL = 'https://github.com/itsdula/nawa';

/** Always the newest desktop build; the release workflow attaches macOS, Windows and Linux packages. */
export const DOWNLOAD_URL = 'https://github.com/itsdula/nawa/releases/latest';

export const RELEASES_URL = 'https://github.com/itsdula/nawa/releases';

export const DOCS_URL = 'https://github.com/itsdula/nawa/tree/main/docs';

/**
 * Flip to `true` once the release workflow has published the first desktop build. Until
 * then `releases/latest` redirects to an empty page, so the page offers the browser app
 * and the source instead of a download that does not exist yet.
 */
export const HAS_DESKTOP_RELEASE = false;
