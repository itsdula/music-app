import { Check, Minus } from 'lucide-react';
import { Container, Pill, cx } from './primitives';

type Level = 'full' | 'partial';

const BROWSERS: { name: string; level: Level; label: string; detail: string }[] = [
  {
    name: 'Chrome and Edge',
    level: 'full',
    label: 'Recommended',
    detail: 'Every feature, including MIDI controllers.',
  },
  {
    name: 'Firefox',
    level: 'partial',
    label: 'Supported',
    detail: 'MIDI controllers need a site-permission add-on.',
  },
  {
    name: 'Safari',
    level: 'partial',
    label: 'No MIDI',
    detail: 'Safari has no Web MIDI, so hardware controllers are unavailable.',
  },
];

export function BrowserSupport() {
  return (
    <section
      id="browsers"
      aria-labelledby="browsers-title"
      className="scroll-mt-16 border-t border-line/60 py-16 sm:py-20"
    >
      <Container className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] lg:items-start">
        <div>
          <h2 id="browsers-title" className="text-xl font-semibold tracking-tight text-text">
            Browser support
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-text-muted">
            Studio works best in a current desktop browser.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3">
          {BROWSERS.map((b) => (
            <li key={b.name} className="rounded-xl border border-line bg-surface-1 p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 font-semibold text-text">
                  <span
                    aria-hidden="true"
                    className={cx(
                      'flex size-5 items-center justify-center rounded-full [&_svg]:size-3',
                      b.level === 'full'
                        ? 'bg-success/15 text-success'
                        : 'bg-warning/15 text-warning',
                    )}
                  >
                    {b.level === 'full' ? <Check /> : <Minus />}
                  </span>
                  {b.name}
                </h3>
                <Pill tone={b.level === 'full' ? 'success' : 'neutral'}>{b.label}</Pill>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-text-muted">{b.detail}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
