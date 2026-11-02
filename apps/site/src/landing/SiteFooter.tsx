import { version as SITE_VERSION } from '../../package.json';
import { STUDIO_URL } from '../urls';
import { DOCS_URL, DOWNLOAD_URL, GITHUB_URL, HAS_DESKTOP_RELEASE, RELEASES_URL } from './links';
import { Container, GitHubIcon, NawaMark, cx, focusRing } from './primitives';

// min-h-11 on touch screens keeps every footer link a comfortable 44px target.
const linkClass = cx(
  'inline-flex items-center gap-1.5 rounded-md py-1 text-sm text-text-muted transition-colors hover:text-text pointer-coarse:min-h-11',
  focusRing,
);

// SITE_VERSION is the site package's version; Vite inlines just that field of the JSON.
const COPYRIGHT_YEAR = new Date().getFullYear();

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: STUDIO_URL, label: 'Open Nawa' },
      ...(HAS_DESKTOP_RELEASE ? [{ href: DOWNLOAD_URL, label: 'Download' }] : []),
      { href: '#features', label: 'Features' },
      { href: '#try', label: 'Try the synth' },
    ],
  },
  {
    title: 'Project',
    links: [
      { href: GITHUB_URL, label: 'Source code' },
      { href: DOCS_URL, label: 'Documentation' },
      { href: RELEASES_URL, label: 'Releases' },
      { href: `${GITHUB_URL}/issues`, label: 'Report an issue' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.06] pt-16 pb-12">
      <Container>
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-12">
          <div className="col-span-2 flex flex-col gap-4 md:col-span-1">
            <p className="flex items-center gap-2.5 text-[15px] font-semibold text-text">
              <NawaMark className="size-7" />
              Nawa
            </p>
            <p className="max-w-sm text-sm leading-relaxed text-text-muted">
              A local-first music workstation. Arrange, record, tune and mix in your browser or on
              your desktop.
            </p>
            <a href={GITHUB_URL} className={cx(linkClass, 'w-fit')}>
              <GitHubIcon className="size-4" />
              itsdula/nawa
            </a>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="font-mono text-[11px] tracking-[0.16em] text-text-muted uppercase">
                {column.title}
              </p>
              <ul className="mt-3 grid gap-1">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className={linkClass}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-14 flex flex-col gap-3 border-t border-white/[0.06] pt-8 text-xs leading-relaxed text-text-muted md:flex-row md:items-start md:justify-between md:gap-10">
          <p className="tabular-nums">
            &copy; {COPYRIGHT_YEAR} Nawa &middot; v{SITE_VERSION}
          </p>
          <p className="max-w-xl md:text-right">
            AKAI Professional and MPK Mini are trademarks of their owner; Nawa is not affiliated
            with or endorsed by AKAI Professional.
          </p>
        </div>
      </Container>
    </footer>
  );
}
