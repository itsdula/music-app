import { ArrowDown, ArrowRight } from 'lucide-react';
import { ArrangementIllustration } from './illustrations';
import { Container, CtaLink, Pill } from './primitives';

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="landing-hero relative overflow-hidden">
      <Container className="relative grid items-center gap-12 pt-16 pb-20 sm:pt-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10 lg:pt-28 lg:pb-28">
        <div className="max-w-xl">
          <div className="flex flex-wrap gap-2">
            <Pill tone="accent">Local-first</Pill>
            <Pill>No account</Pill>
            <Pill>Runs in your browser</Pill>
          </div>
          <h1
            id="hero-title"
            className="mt-6 text-5xl font-semibold tracking-tight text-text sm:text-6xl lg:text-7xl"
          >
            Studio
          </h1>
          <p className="mt-4 text-xl leading-snug font-medium text-balance text-text sm:text-2xl">
            A music workstation that runs in your browser.
          </p>
          <p className="mt-4 text-base leading-relaxed text-pretty text-text-muted sm:text-lg">
            Arrange, play, record, mix and export a song without installing anything or creating an
            account. Your projects stay on your device.
          </p>
          <div className="mt-8 flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center">
            <CtaLink href="/studio">
              Open Studio
              <ArrowRight aria-hidden="true" />
            </CtaLink>
            <CtaLink href="#features" variant="secondary">
              See what it does
              <ArrowDown aria-hidden="true" />
            </CtaLink>
          </div>
        </div>
        <div className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-8 rounded-[40px] bg-[radial-gradient(closest-side,rgb(139_124_246/0.18),transparent)]"
          />
          <ArrangementIllustration className="relative h-auto w-full drop-shadow-[0_24px_48px_rgb(0_0_0/0.45)]" />
        </div>
      </Container>
    </section>
  );
}
