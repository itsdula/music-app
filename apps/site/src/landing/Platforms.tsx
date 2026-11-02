import { ArrowRight, Download, FileArchive, Globe, Lock, Monitor, Puzzle } from 'lucide-react';
import type { ReactNode } from 'react';
import { STUDIO_URL } from '../urls';
import { DOWNLOAD_URL, HAS_DESKTOP_RELEASE, RELEASES_URL } from './links';
import { GitHubIcon } from './primitives';
import { Container, CtaLink, Pill, SectionHeader, cx, trackSpotlight } from './primitives';
import { Reveal, StaggerItem, StaggerList } from './reveal';

const PRINCIPLES: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Lock />,
    title: 'Your work stays on your device',
    body: 'Projects and recordings are stored locally. Core features need no account, server or network connection.',
  },
  {
    icon: <FileArchive />,
    title: 'Open project format',
    body: 'Projects use a versioned, documented format. Bundles package a project with its audio so you can take it anywhere.',
  },
  {
    icon: <Puzzle />,
    title: 'One workstation, every host',
    body: 'The whole workstation is a single component, so the browser and the desktop app run exactly the same code.',
  },
];

function PlatformCard({
  icon,
  title,
  body,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      onPointerMove={trackSpotlight}
      className={cx(
        'nawa-hairline nawa-spotlight relative flex h-full flex-col overflow-hidden rounded-3xl bg-ink-raised/80 p-7 sm:p-9',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-accent-strong [&_svg]:size-5"
      >
        {icon}
      </span>
      <h3 className="mt-6 text-2xl font-semibold tracking-[-0.02em] text-text">{title}</h3>
      <p className="mt-3 text-[15px] leading-relaxed text-text-muted">{body}</p>
      <div className="mt-8 flex flex-1 flex-col justify-end gap-5">{children}</div>
    </div>
  );
}

export function Platforms() {
  return (
    <section
      id="download"
      aria-labelledby="download-title"
      className="relative scroll-mt-20 border-t border-white/[0.06] py-16 sm:py-24 lg:py-28"
    >
      <Container>
        <Reveal>
          <SectionHeader
            id="download-title"
            eyebrow="Local-first"
            title={
              <>
                Your music stays on your machine.{' '}
                <span className="text-text-muted">In a tab or its own window.</span>
              </>
            }
          >
            <p>
              {HAS_DESKTOP_RELEASE
                ? 'Use Nawa in a browser tab, or install the desktop app.'
                : 'Use Nawa in a browser tab today; a desktop app is on the way.'}{' '}
              Either way your projects live on your machine, not on someone else&rsquo;s server.
            </p>
          </SectionHeader>
        </Reveal>

        <div className="mt-14 grid gap-4 lg:grid-cols-2">
          <Reveal>
            <PlatformCard
              icon={<Globe />}
              title="In the browser"
              body="Open a tab and start working. Nothing to install, and projects are saved in the browser as you go."
            >
              <div className="flex flex-wrap gap-2">
                <Pill tone="success">Chrome</Pill>
                <Pill tone="success">Edge</Pill>
                <Pill>Firefox</Pill>
                <Pill>Safari</Pill>
              </div>
              <div>
                <CtaLink href={STUDIO_URL}>
                  Open Nawa
                  <ArrowRight aria-hidden="true" className="nawa-cta-arrow" />
                </CtaLink>
              </div>
            </PlatformCard>
          </Reveal>
          <Reveal delay={0.08}>
            <PlatformCard
              icon={<Monitor />}
              title="On your desktop"
              body={
                HAS_DESKTOP_RELEASE
                  ? 'The same workstation in its own window, with its own app icon. Builds are published on GitHub Releases.'
                  : 'The same workstation in its own window, with its own app icon. The first builds will be published on GitHub Releases.'
              }
            >
              <div className="flex flex-wrap gap-2">
                <Pill>macOS</Pill>
                <Pill>Windows</Pill>
                <Pill>Linux</Pill>
                {HAS_DESKTOP_RELEASE ? null : <Pill tone="accent">Coming soon</Pill>}
              </div>
              <div>
                {HAS_DESKTOP_RELEASE ? (
                  <CtaLink href={DOWNLOAD_URL} variant="secondary">
                    <Download aria-hidden="true" />
                    Download for desktop
                  </CtaLink>
                ) : (
                  <CtaLink href={RELEASES_URL} variant="secondary">
                    <GitHubIcon />
                    Follow releases on GitHub
                  </CtaLink>
                )}
              </div>
            </PlatformCard>
          </Reveal>
        </div>

        <StaggerList className="mt-4 grid gap-4 md:grid-cols-3">
          {PRINCIPLES.map((item) => (
            <StaggerItem
              key={item.title}
              className="rounded-3xl border border-white/[0.06] bg-white/[0.015] p-6"
            >
              <span
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent-strong [&_svg]:size-[18px]"
              >
                {item.icon}
              </span>
              <h3 className="mt-5 font-semibold text-text">{item.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-text-muted">{item.body}</p>
            </StaggerItem>
          ))}
        </StaggerList>
      </Container>
    </section>
  );
}
