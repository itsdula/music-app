import { ArrowRight, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { STUDIO_URL } from '../urls';
import { DOWNLOAD_URL, GITHUB_URL, HAS_DESKTOP_RELEASE } from './links';
import { Container, CtaLink, GitHubIcon } from './primitives';
import { Reveal } from './reveal';

/** Bar width plus gap, in px: the marquee tiles whole bars across the card. */
const BAR_PITCH = 11;

/** A gently varied but fixed waveform, so every render draws the same shape. */
function waveHeight(i: number): number {
  const v = Math.abs(Math.sin(i * 0.42) * 0.6 + Math.sin(i * 0.13) * 0.4);
  return 0.15 + v * 0.85;
}

/**
 * Bars drift sideways behind the CTA. The count follows the card's width (one copy fills
 * it exactly), and the copy is drawn twice so the marquee loops without a seam; both
 * edges fade with the same mask, so the strip sits centred.
 */
function WaveBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(96);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCount(Math.max(24, Math.ceil(entry.contentRect.width / BAR_PITCH)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const bars = Array.from({ length: count }, (_, i) => waveHeight(i));

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-40 overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_18%,#000_82%,transparent)] sm:h-52"
    >
      <div className="nawa-marquee flex h-full w-max items-end">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex h-full items-end gap-[6px] pr-[6px]">
            {bars.map((v, i) => (
              <span
                key={i}
                className="nawa-bar block w-[5px] rounded-t-full bg-gradient-to-t from-accent/0 via-accent/40 to-accent-strong/70"
                style={{
                  height: `${v * 100}%`,
                  animationDelay: `${-((i * 0.37) % 1.1)}s`,
                  animationDuration: `${1.4 + (i % 5) * 0.18}s`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="py-16 sm:py-24 lg:py-28">
      <Container>
        <Reveal>
          <div className="nawa-hairline relative isolate overflow-hidden rounded-[32px] bg-[radial-gradient(80%_100%_at_50%_0%,rgb(139_124_246/0.22),transparent_70%),linear-gradient(180deg,#14161d,#0c0d12)] px-6 pt-16 pb-44 text-center sm:px-12 sm:pt-24 sm:pb-56">
            <WaveBackdrop />
            <h2
              id="cta-title"
              className="relative mx-auto max-w-2xl text-4xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance text-text sm:text-6xl"
            >
              Start your next track in the browser
            </h2>
            <p className="relative mx-auto mt-5 max-w-md text-base leading-relaxed text-text-muted sm:text-lg">
              {HAS_DESKTOP_RELEASE
                ? 'No account. Runs in your browser, or download the desktop app.'
                : 'No account. It runs in your browser and saves your project on this device as you work.'}
            </p>
            <div className="relative mt-10 flex flex-col items-stretch justify-center gap-3 min-[460px]:flex-row min-[460px]:items-center">
              <CtaLink href={STUDIO_URL}>
                Open Nawa
                <ArrowRight aria-hidden="true" className="nawa-cta-arrow" />
              </CtaLink>
              {HAS_DESKTOP_RELEASE ? (
                <CtaLink href={DOWNLOAD_URL} variant="secondary">
                  <Download aria-hidden="true" />
                  Download for desktop
                </CtaLink>
              ) : (
                <CtaLink href={GITHUB_URL} variant="secondary">
                  <GitHubIcon />
                  View on GitHub
                </CtaLink>
              )}
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
