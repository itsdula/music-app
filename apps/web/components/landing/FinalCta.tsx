import { ArrowRight } from 'lucide-react';
import { Container, CtaLink } from './primitives';

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="pb-20 sm:pb-28">
      <Container>
        <div className="landing-cta relative overflow-hidden rounded-3xl border border-line bg-surface-1 px-6 py-14 text-center sm:px-12 sm:py-20">
          <h2
            id="cta-title"
            className="text-3xl font-semibold tracking-tight text-balance text-text sm:text-4xl"
          >
            Start your next track in the browser
          </h2>
          <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-text-muted sm:text-lg">
            No account, no install. Your project is saved on this device as you work.
          </p>
          <div className="mt-8 flex justify-center">
            <CtaLink href="/studio">
              Open Studio
              <ArrowRight aria-hidden="true" />
            </CtaLink>
          </div>
        </div>
      </Container>
    </section>
  );
}
