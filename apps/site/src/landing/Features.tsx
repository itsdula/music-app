import {
  Download,
  GraduationCap,
  HardDrive,
  Layers,
  Mic,
  SlidersHorizontal,
  Sparkles,
  Usb,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Container, SectionHeader, cx, trackSpotlight } from './primitives';
import { Reveal, StaggerItem, StaggerList } from './reveal';

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
    <StaggerItem
      onPointerMove={trackSpotlight}
      className={cx(
        'nawa-hairline nawa-spotlight nawa-lift group relative flex flex-col overflow-hidden rounded-3xl bg-ink-raised/80 p-6 sm:p-7',
        className,
      )}
    >
      {visual ? (
        <div aria-hidden="true" className="relative -mx-6 -mt-6 mb-6 sm:-mx-7 sm:-mt-7">
          {visual}
        </div>
      ) : null}
      <div>
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-accent-strong transition-colors duration-300 group-hover:border-accent/40 group-hover:bg-accent/10 [&_svg]:size-[18px]"
        >
          {icon}
        </span>
        <h3 className="mt-5 text-lg font-semibold tracking-tight text-text">{title}</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-text-muted">{children}</p>
      </div>
    </StaggerItem>
  );
}

/* ---------------------------------------------------------------------------------- */
/* Card visuals: small, decorative, CSS-animated (and static under reduced motion).    */
/* ---------------------------------------------------------------------------------- */

const CLIPS: { lane: number; start: number; len: number; tone: string; label: string }[] = [
  { lane: 0, start: 0.5, len: 37, tone: 'bg-accent', label: 'Beat' },
  { lane: 0, start: 38, len: 37, tone: 'bg-accent', label: 'Beat' },
  { lane: 1, start: 12.5, len: 50, tone: 'bg-[#5b9bea]', label: 'Bassline' },
  { lane: 2, start: 25, len: 25, tone: 'bg-success', label: 'Chords' },
  { lane: 2, start: 50.5, len: 37, tone: 'bg-success', label: 'Chords' },
  { lane: 3, start: 37.5, len: 37, tone: 'bg-[#f08a6b]', label: 'Vocal take' },
];

function TimelineVisual() {
  return (
    <div className="border-b border-white/[0.06] p-4 sm:p-5">
      <div className="relative h-44 overflow-hidden rounded-xl border border-white/[0.06] bg-black/20 bg-[linear-gradient(to_right,rgb(255_255_255/0.04)_1px,transparent_1px)] bg-[length:12.5%_100%] sm:h-[11.5rem]">
        <div className="absolute inset-x-0 top-0 flex h-7 items-center border-b border-white/[0.06] bg-white/[0.02] font-mono text-[11px] text-text-muted">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((bar) => (
            <span key={bar} className="w-[12.5%] pl-2">
              {bar}
            </span>
          ))}
        </div>
        <div className="absolute inset-x-0 top-10 bottom-3">
          {CLIPS.map((clip, i) => (
            <div
              key={i}
              className={cx(
                'absolute h-8 overflow-hidden rounded-md border border-white/20 px-2 pt-1.5 text-[11px] leading-none font-semibold text-ink',
                clip.tone,
              )}
              style={{ top: `${clip.lane * 36}px`, left: `${clip.start}%`, width: `${clip.len}%` }}
            >
              {clip.label}
            </div>
          ))}
        </div>
        <div className="absolute inset-0">
          <div className="nawa-playhead h-full w-full border-r-[1.5px] border-white/85 motion-reduce:hidden" />
        </div>
      </div>
    </div>
  );
}

function MeterVisual() {
  const channels = [0.9, 0.7, 0.8, 0.55, 0.95];
  return (
    <div className="flex h-52 items-end justify-center gap-5 border-b border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent px-6 pb-6 sm:h-56">
      {channels.map((peak, i) => (
        <div key={i} className="flex h-full items-end gap-1">
          {[0, 1].map((side) => (
            <div
              key={side}
              className="relative h-[85%] w-2 overflow-hidden rounded-full bg-white/[0.06]"
            >
              <div
                className="nawa-bar absolute inset-x-0 bottom-0 rounded-full bg-gradient-to-t from-success via-success to-warning"
                style={{
                  height: `${peak * 100}%`,
                  animationDelay: `${-(i * 0.23 + side * 0.11)}s`,
                  animationDuration: `${0.9 + ((i * 7 + side * 3) % 5) * 0.12}s`,
                }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function RecordVisual() {
  // A fixed pseudo-random waveform, so the drawing is the same on every render.
  const bars = Array.from({ length: 48 }, (_, i) => {
    const v = Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.31)) * 0.85 + 0.12;
    return Math.min(1, v);
  });
  return (
    <div className="relative flex h-40 items-center gap-3 border-b border-white/[0.06] px-6">
      <span className="relative flex size-3 shrink-0">
        <span className="nawa-ping absolute inset-0 rounded-full bg-record" />
        <span className="relative size-3 rounded-full bg-record" />
      </span>
      <div className="flex h-16 flex-1 items-center gap-[3px]">
        {bars.map((v, i) => (
          <span
            key={i}
            className="w-full rounded-full bg-record/70"
            style={{ height: `${v * 100}%`, opacity: 0.35 + (i / bars.length) * 0.65 }}
          />
        ))}
      </div>
    </div>
  );
}

/** Two octaves of keys; a short phrase lights some of them in turn. */
const WHITE_KEYS = 14;
const BLACK_AFTER = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12]; // white-key indexes followed by a black key
const PHRASE: { key: number; black: boolean; delay: number }[] = [
  { key: 0, black: false, delay: 0 },
  { key: 2, black: false, delay: 0.4 },
  { key: 4, black: false, delay: 0.8 },
  { key: 3, black: true, delay: 1.2 },
  { key: 7, black: false, delay: 1.6 },
  { key: 9, black: false, delay: 2.0 },
  { key: 8, black: true, delay: 2.4 },
];

function KeyboardVisual() {
  const lit = (key: number, black: boolean) =>
    PHRASE.find((p) => p.key === key && p.black === black);
  return (
    <div className="flex h-40 items-end justify-center border-b border-white/[0.06] px-6 pb-6">
      <div className="relative flex h-24 w-full max-w-[300px] gap-[3px]">
        {Array.from({ length: WHITE_KEYS }, (_, i) => {
          const note = lit(i, false);
          return (
            <div key={i} className="relative flex-1 overflow-hidden rounded-b-md bg-[#d9dce3]">
              {note ? (
                <span
                  className="nawa-key absolute inset-0 bg-accent-strong opacity-0"
                  style={{ animationDelay: `${note.delay}s` }}
                />
              ) : null}
            </div>
          );
        })}
        {BLACK_AFTER.map((i) => {
          const note = lit(i, true);
          return (
            <div
              key={`b${i}`}
              className="absolute top-0 h-[58%] w-[4.5%] -translate-x-1/2 overflow-hidden rounded-b-sm bg-[#16181e] ring-1 ring-black/60"
              style={{ left: `${((i + 1) / WHITE_KEYS) * 100}%` }}
            >
              {note ? (
                <span
                  className="nawa-key absolute inset-0 bg-accent opacity-0"
                  style={{ animationDelay: `${note.delay}s` }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A tutorial step as it appears in the app: a callout with progress and Back/Next. */
function TourVisual() {
  return (
    <div className="flex h-36 items-center justify-center border-b border-white/[0.06] px-6">
      <div className="relative w-full max-w-[250px] rounded-xl border border-accent/40 bg-[#1a1830] p-3 shadow-[0_12px_40px_-12px_rgb(139_124_246/0.6)] transition-transform duration-500 ease-out group-hover:-translate-y-1 motion-reduce:transition-none">
        <span className="absolute -top-1.5 left-8 size-3 rotate-45 border-t border-l border-accent/40 bg-[#1a1830]" />
        <p className="font-mono text-[10px] tracking-[0.14em] text-accent-strong uppercase">
          Step 2 of 5
        </p>
        <p className="mt-1 text-[13px] font-medium text-text">Add an effect to the keys</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="flex gap-1">
            {[0, 1, 2, 3, 4].map((dot) => (
              <span
                key={dot}
                className={cx(
                  'h-1 rounded-full',
                  dot <= 1 ? 'w-3 bg-accent-strong' : 'w-1 bg-white/20',
                )}
              />
            ))}
          </span>
          <span className="rounded-md bg-text px-2 py-0.5 text-[11px] font-medium text-ink">
            Next
          </span>
        </div>
      </div>
    </div>
  );
}

/** Projects as the in-browser library lists them, each saved on this device. */
function ProjectsVisual() {
  const projects = [
    { name: 'Demo Groove', meta: '6 tracks · 96 BPM' },
    { name: 'Late night sketch', meta: '3 tracks · 84 BPM' },
  ];
  return (
    <div className="flex h-36 flex-col justify-center gap-2 border-b border-white/[0.06] px-6">
      {projects.map((project, i) => (
        <div
          key={project.name}
          className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 transition-transform duration-500 ease-out group-hover:translate-x-1 motion-reduce:transition-none"
          style={{ transitionDelay: `${i * 60}ms` }}
        >
          <HardDrive className="size-4 shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-text">{project.name}</span>
            <span className="block font-mono text-[10px] text-text-muted">{project.meta}</span>
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className="size-1.5 rounded-full bg-success" />
            Saved
          </span>
        </div>
      ))}
    </div>
  );
}

/** The export: a file chip with its format and a render bar that fills on hover. */
function ExportVisual() {
  return (
    <div className="flex h-36 items-center justify-center border-b border-white/[0.06] px-6">
      <div className="w-full max-w-[250px] rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent/15 font-mono text-[10px] font-semibold text-accent-strong">
            WAV
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-text">
              Demo Groove.wav
            </span>
            <span className="block font-mono text-[10px] text-text-muted">
              24-bit · 48 kHz · stereo
            </span>
          </span>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full w-full origin-left scale-x-[0.35] rounded-full bg-gradient-to-r from-accent to-success transition-transform duration-[1200ms] ease-out group-hover:scale-x-100 motion-reduce:transition-none" />
        </div>
      </div>
    </div>
  );
}

const EFFECTS = ['Gain', 'EQ Three', 'Compressor', 'Reverb', 'Delay', 'Distortion'];

function EffectsVisual() {
  return (
    <div className="flex h-40 flex-wrap content-center items-center justify-center gap-2 border-b border-white/[0.06] px-6">
      {EFFECTS.map((name, i) => (
        <span
          key={name}
          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[11px] text-text transition-colors duration-300 group-hover:border-accent/40"
          style={{ transitionDelay: `${i * 40}ms` }}
        >
          {name}
        </span>
      ))}
    </div>
  );
}

export function Features() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="relative scroll-mt-20 pt-8 pb-16 sm:pt-12 sm:pb-24 lg:pb-28"
    >
      <Container>
        <Reveal>
          <SectionHeader
            id="features-title"
            eyebrow="Features"
            title={
              <>
                Everything a song needs. <span className="text-text-muted">In one tab.</span>
              </>
            }
          >
            <p>
              Nawa covers the full path from first idea to finished file: write parts, record takes,
              shape the mix and export it.
            </p>
          </SectionHeader>
        </Reveal>

        <StaggerList className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={<Layers />}
            title="Multitrack arrangement"
            className="lg:col-span-2"
            visual={<TimelineVisual />}
          >
            Lay out clips on a timeline that snaps to the grid. Move, trim, split, loop and fade
            them; every edit is non-destructive.
          </FeatureCard>
          <FeatureCard
            icon={<SlidersHorizontal />}
            title="Mixer with meters"
            visual={<MeterVisual />}
          >
            Balance every track with faders, pan, mute and solo, and watch levels on stereo meters.
          </FeatureCard>
          <FeatureCard
            icon={<Sparkles />}
            title="Instruments and effects"
            visual={<EffectsVisual />}
          >
            A polyphonic synth with pad, bass, lead, pluck and keys presets, a synthesized drum kit,
            a sampler, and six built-in effects.
          </FeatureCard>
          <FeatureCard icon={<Mic />} title="Microphone recording" visual={<RecordVisual />}>
            Record vocals or instruments onto a track, with latency compensation to keep takes in
            time.
          </FeatureCard>
          <FeatureCard icon={<Usb />} title="Web MIDI controllers" visual={<KeyboardVisual />}>
            Plug in a MIDI keyboard and play. The AKAI Professional MPK Mini MK3 gets mapped keys,
            pads and knobs out of the box.
          </FeatureCard>
          <FeatureCard icon={<GraduationCap />} title="Guided tutorials" visual={<TourVisual />}>
            Built-in tours walk you through the workstation step by step, right inside the app.
          </FeatureCard>
          <FeatureCard icon={<HardDrive />} title="Projects stay local" visual={<ProjectsVisual />}>
            Projects are saved in your browser as you work. Export a portable bundle to back up or
            move to another computer.
          </FeatureCard>
          <FeatureCard icon={<Download />} title="Offline WAV export" visual={<ExportVisual />}>
            Render the finished mix to a WAV file at{' '}
            <span className="tabular-nums">16 or 24-bit, 44.1 or 48 kHz</span>.
          </FeatureCard>
        </StaggerList>
      </Container>
    </section>
  );
}
