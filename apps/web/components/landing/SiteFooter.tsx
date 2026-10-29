import { ArrowUp } from 'lucide-react';
import { StudioMark } from './SiteHeader';
import { Container, focusRing, cx } from './primitives';

const linkClass = cx(
  'inline-flex items-center gap-1.5 rounded-md text-sm text-text-muted transition-colors hover:text-text [&_svg]:size-3.5',
  focusRing,
);

export function SiteFooter() {
  return (
    <footer className="border-t border-line/60 py-10">
      <Container className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-text">
            <StudioMark className="size-5" />
            Studio
          </p>
          <p className="max-w-md text-xs leading-relaxed text-text-muted">
            A local-first music workstation. AKAI Professional and MPK Mini are trademarks of their
            owner; Studio is not affiliated with or endorsed by AKAI Professional.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex items-center gap-6">
            <li>
              <a href="/studio" className={linkClass}>
                Open Studio
              </a>
            </li>
            <li>
              <a href="#top" className={linkClass}>
                <ArrowUp aria-hidden="true" />
                Back to top
              </a>
            </li>
          </ul>
        </nav>
      </Container>
    </footer>
  );
}
