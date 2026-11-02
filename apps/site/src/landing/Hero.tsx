import { ArrowRight, Download, Laptop } from 'lucide-react';
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import { useRef } from 'react';
import { STUDIO_URL } from '../urls';
import { DOWNLOAD_URL, GITHUB_URL, HAS_DESKTOP_RELEASE } from './links';
import { Container, CtaLink, GitHubIcon, cx, focusRing } from './primitives';
import { EASE_OUT } from './reveal';
import { ScreenshotFrame } from './ScreenshotFrame';

/** Staggered entrance for the hero's text column, played once on load. */
function useEntrance(order: number) {
  const reduce = useReducedMotion();
  return {
    initial: reduce ? false : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, ease: EASE_OUT, delay: 0.05 + order * 0.07 },
  } as const;
}

/**
 * The hero screenshot starts tilted back and straightens as it scrolls up to meet the
 * reader, like a lid opening. Driven by scroll progress through a spring so it stays
 * smooth on coarse wheels; transform only.
 */
function HeroShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 0.25'] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  const rotateX = useTransform(progress, [0, 1], [22, 0]);
  const scale = useTransform(progress, [0, 1], [0.9, 1]);
  const glow = useTransform(progress, [0, 1], [0.35, 1]);

  return (
    <motion.div
      ref={ref}
      className="relative mx-auto mt-12 max-w-5xl [perspective:1600px] sm:mt-16"
      initial={reduce ? false : { opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.25 }}
    >
      <motion.div
        aria-hidden="true"
        style={reduce ? undefined : { opacity: glow }}
        className="pointer-events-none absolute -inset-x-10 -top-16 -bottom-10 rounded-[48px] bg-[radial-gradient(50%_55%_at_50%_45%,rgb(139_124_246/0.32),transparent_70%)]"
      />
      <motion.div
        style={reduce ? undefined : { rotateX, scale, transformOrigin: '50% 0%' }}
        className="relative"
      >
        <ScreenshotFrame
          src="screenshots/studio-overview.webp"
          mobileSrc="screenshots/studio-overview-mobile.webp"
          alt="Nawa playing its demo project: drums, bass, keys, pad, pluck and a vocal take in the arrangement, with level meters moving and the mixer below"
          title="Demo Groove"
          loading="eager"
        />
      </motion.div>
    </motion.div>
  );
}

export function Hero() {
  const pill = useEntrance(0);
  const title = useEntrance(1);
  const lead = useEntrance(2);
  const body = useEntrance(3);
  const ctas = useEntrance(4);

  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* Background: drifting colour fields and a fading grid. Decorative only. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="nawa-aurora nawa-aurora-a top-[-12%] left-[8%] h-[360px] w-[420px] bg-[#5b46e8] opacity-45 sm:h-[520px] sm:w-[620px]" />
        <div className="nawa-aurora nawa-aurora-b top-[4%] right-[2%] h-[300px] w-[340px] bg-[#1f9e8f] opacity-25 sm:h-[420px] sm:w-[520px]" />
        <div className="nawa-grid absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-b from-transparent to-ink" />
      </div>

      <Container className="pt-28 pb-12 sm:pt-36 sm:pb-20">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          {HAS_DESKTOP_RELEASE ? (
            <motion.a
              {...pill}
              href={DOWNLOAD_URL}
              aria-label="New: the desktop app for macOS, Windows and Linux"
              className={cx(
                'group inline-flex min-h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pr-3 pl-1 text-[13px] text-text-muted backdrop-blur transition-colors hover:border-white/20 hover:text-text',
                focusRing,
              )}
            >
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent-strong">
                New
              </span>
              <span>Desktop app for macOS, Windows and Linux</span>
              <ArrowRight
                aria-hidden="true"
                className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none"
              />
            </motion.a>
          ) : (
            <motion.p
              {...pill}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] text-text-muted uppercase backdrop-blur"
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
              Runs in your browser &middot; No account
            </motion.p>
          )}

          <motion.h1
            {...title}
            id="hero-title"
            className="nawa-wordmark mt-7 pb-2 text-[5.5rem] leading-[0.9] font-semibold tracking-[-0.06em] sm:text-[8rem] lg:text-[9rem]"
          >
            Nawa
          </motion.h1>

          <motion.p
            {...lead}
            className="mt-5 text-2xl leading-tight font-medium tracking-[-0.02em] text-balance text-text sm:text-[2rem]"
          >
            A local-first music workstation in your browser.
          </motion.p>

          <motion.p
            {...body}
            className="mt-5 max-w-xl text-base leading-relaxed text-pretty text-text-muted sm:text-lg"
          >
            Arrange, play, record, tune and mix a song in a single tab. No account and no upload:
            your projects stay on your device.
          </motion.p>

          <motion.div
            {...ctas}
            className="mt-10 flex w-full flex-col items-stretch gap-3 min-[460px]:w-auto min-[460px]:flex-row min-[460px]:items-center"
          >
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
          </motion.div>
          {/* Nawa is a desktop-class workstation; say so before a phone visitor taps in. */}
          <motion.p
            {...ctas}
            className="mt-5 flex items-center gap-2 text-sm text-text-muted sm:hidden"
          >
            <Laptop aria-hidden="true" className="size-4 shrink-0" />
            Best on a laptop or desktop with Chrome or Edge.
          </motion.p>
          {HAS_DESKTOP_RELEASE ? (
            <motion.p {...ctas} className="mt-4 text-sm text-text-muted sm:mt-6">
              <a
                href={GITHUB_URL}
                className={cx(
                  'inline-flex items-center gap-2 rounded-md py-2.5 underline-offset-4 transition-colors hover:text-text hover:underline',
                  focusRing,
                )}
              >
                <GitHubIcon className="size-4" />
                View the source on GitHub
              </a>
            </motion.p>
          ) : null}
        </div>

        <HeroShowcase />
      </Container>
    </section>
  );
}
