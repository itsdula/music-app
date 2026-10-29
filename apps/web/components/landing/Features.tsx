import { Download, HardDrive, Layers, Mic, Piano, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { PianoRollIllustration } from './illustrations';
import { Container, SectionHeader, cx } from './primitives';

function FeatureCard({
  icon,
  title,
  children,
  visual,
  className,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  visual?: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cx(
        'flex flex-col gap-6 rounded-2xl border border-line bg-surface-1 p-6 sm:p-7',
        visual ? 'lg:flex-row lg:items-center' : '',
        className,
      )}
    >
      <div className={cx('flex flex-col', visual ? 'lg:max-w-[46%]' : '')}>
        <span
          className="flex size-10 items-center justify-center rounded-lg border border-line bg-surface-2 text-accent-strong [&_svg]:size-5"
          aria-hidden="true"
        >
          {icon}
        </span>
        <h3 className="mt-5 text-lg font-semibold text-text">{title}</h3>
        <div className="mt-2 text-[15px] leading-relaxed text-text-muted">{children}</div>
      </div>
      {visual ? <div className="min-w-0 flex-1">{visual}</div> : null}
    </li>
  );
}

const EFFECTS = ['Gain', '3-band EQ', 'Compressor', 'Reverb', 'Delay', 'Distortion'];

function EffectsRack() {
  return (
    <ol aria-label="Built-in effects" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {EFFECTS.map((name, i) => (
        <li
          key={name}
          className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-2/70 px-3 py-2.5 text-sm text-text"
        >
          <span
            aria-hidden="true"
            className="text-xs font-medium text-text-muted tabular-nums"
          >{`0${i + 1}`}</span>
          {name}
        </li>
      ))}
    </ol>
  );
}

export function Features() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="scroll-mt-16 border-t border-line/60 py-20 sm:py-28"
    >
      <Container>
        <SectionHeader
          id="features-title"
          eyebrow="Features"
          title="A complete workstation, in a tab"
        >
          <p>
            Studio covers the full path from first idea to finished file: write parts, record takes,
            shape the mix and export it.
          </p>
        </SectionHeader>
        <ul className="mt-12 grid gap-4 lg:grid-cols-3">
          <FeatureCard icon={<Layers />} title="Multitrack arrangement">
            Lay out clips on a timeline that snaps to the grid. Move, trim, split, loop and fade
            them without changing the source audio: every edit is non-destructive.
          </FeatureCard>
          <FeatureCard
            icon={<Piano />}
            title="Piano roll and instruments"
            className="lg:col-span-2"
            visual={<PianoRollIllustration className="h-auto w-full" />}
          >
            Draw and edit notes in a piano roll. Play them with a polyphonic synth (pad, bass, lead,
            pluck and keys presets) or a synthesized drum kit.
          </FeatureCard>
          <FeatureCard
            icon={<SlidersHorizontal />}
            title="Mixer and effects"
            className="lg:col-span-2"
            visual={<EffectsRack />}
          >
            Balance tracks in the mixer and shape each one with six built-in effects.
          </FeatureCard>
          <FeatureCard icon={<Mic />} title="Microphone recording">
            Record vocals or instruments straight onto a track. Audio latency varies between
            browsers and devices, so Studio lets you compensate for it and keep takes in time.
          </FeatureCard>
          <FeatureCard icon={<Download />} title="Offline WAV export">
            Render the finished mix offline to a WAV file at{' '}
            <span className="tabular-nums">16- or 24-bit, 44.1 or 48 kHz</span>.
          </FeatureCard>
          <FeatureCard icon={<HardDrive />} title="Local projects" className="lg:col-span-2">
            Projects are saved in your browser, with no upload and no account. Export a portable
            project bundle to back up your work or move it to another computer.
          </FeatureCard>
        </ul>
      </Container>
    </section>
  );
}
