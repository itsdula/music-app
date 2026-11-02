import { ArrowRight } from 'lucide-react';
import { useMotionValueEvent, useScroll } from 'motion/react';
import { useState } from 'react';
import { STUDIO_URL } from '../urls';
import { GITHUB_URL } from './links';
import { Container, CtaLink, GitHubIcon, NawaMark, cx, focusRing } from './primitives';

const NAV = [
  { href: '#features', label: 'Features' },
  { href: '#workflow', label: 'Workflow' },
  { href: '#try', label: 'Try it' },
  { href: '#download', label: 'Download' },
];

export function SiteHeader() {
  // The bar is transparent over the hero and gains a surface once the page scrolls. This
  // flips state once at the threshold, not on every scroll frame.
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => {
    const next = y > 12;
    if (next !== scrolled) setScrolled(next);
  });

  return (
    <header
      className={cx(
        'fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color] duration-300',
        scrolled
          ? 'border-white/[0.07] bg-ink/75 backdrop-blur-xl supports-[not(backdrop-filter:blur(0))]:bg-ink'
          : 'border-transparent bg-transparent',
      )}
    >
      <a
        href="#main"
        className={cx(
          'sr-only rounded-full bg-text px-4 py-2 text-sm font-medium text-ink focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-10',
          focusRing,
        )}
      >
        Skip to content
      </a>
      <Container className="flex h-16 items-center justify-between gap-4">
        <a
          href="#top"
          className={cx(
            'group flex items-center gap-2.5 rounded-md text-[15px] font-semibold tracking-tight text-text',
            focusRing,
          )}
        >
          <NawaMark className="size-7 transition-transform duration-500 ease-out group-hover:rotate-[-8deg] motion-reduce:transition-none" />
          <span>Nawa</span>
        </a>
        <nav aria-label="Sections" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className={cx(
                    'rounded-full px-3.5 py-1.5 text-sm text-text-muted transition-colors hover:bg-white/[0.05] hover:text-text',
                    focusRing,
                  )}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <a
            href={GITHUB_URL}
            aria-label="Nawa on GitHub"
            className={cx(
              'flex size-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text',
              focusRing,
            )}
          >
            <GitHubIcon className="size-[18px]" />
          </a>
          <CtaLink href={STUDIO_URL} size="sm" className="h-10 sm:h-8">
            Open Nawa
            <ArrowRight aria-hidden="true" className="nawa-cta-arrow" />
          </CtaLink>
        </div>
      </Container>
      <div
        aria-hidden="true"
        className="nawa-progress absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-accent via-accent-strong to-success"
      />
    </header>
  );
}
