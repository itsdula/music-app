import { ArrowRight } from 'lucide-react';
import { Container, CtaLink, focusRing, cx } from './primitives';

const NAV = [
  { href: '#features', label: 'Features' },
  { href: '#controller', label: 'Controller' },
  { href: '#vocal-editor', label: 'Vocal editor' },
  { href: '#portable', label: 'Portable' },
];

/** Original wordmark glyph: three rising bars inside a rounded square. */
export function StudioMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <rect x="0.5" y="0.5" width="23" height="23" rx="6" fill="var(--color-accent)" />
      <path
        d="M7 15.5v-3M12 17V7M17 15.5v-6"
        stroke="var(--color-surface-0)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-surface-0/80 backdrop-blur-md supports-[not(backdrop-filter:blur(0))]:bg-surface-0">
      <a
        href="#main"
        className={cx(
          'sr-only rounded-md bg-accent px-3 py-2 text-sm font-medium text-surface-0 focus:not-sr-only focus:absolute focus:top-3 focus:left-3',
          focusRing,
        )}
      >
        Skip to content
      </a>
      <Container className="flex h-14 items-center justify-between gap-4">
        <a
          href="#top"
          className={cx('flex items-center gap-2 rounded-md font-semibold text-text', focusRing)}
        >
          <StudioMark className="size-6" />
          <span>Studio</span>
        </a>
        <nav aria-label="Sections" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className={cx(
                    'rounded-md px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text',
                    focusRing,
                  )}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <CtaLink href="/studio" size="sm">
          Open Studio
          <ArrowRight aria-hidden="true" />
        </CtaLink>
      </Container>
    </header>
  );
}
