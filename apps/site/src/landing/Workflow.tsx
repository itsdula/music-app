import { Check, Info } from 'lucide-react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Container, Pill, SectionHeader } from './primitives';
import { Reveal } from './reveal';
import { ScreenshotFrame } from './ScreenshotFrame';

interface Step {
  id: string;
  title: string;
  body: string;
  points: string[];
  note?: ReactNode;
  /** `mobileSrc` is a tighter crop of the same capture for phones. */
  shot: { src: string; mobileSrc: string; alt: string; title: string };
}

const STEPS: Step[] = [
  {
    id: 'write',
    title: 'Write parts in the piano roll',
    body: 'Draw and edit notes with velocity, then hear them on a polyphonic synth, the drum kit or the sampler.',
    points: [
      'Notes snap to the grid',
      'Per-note velocity',
      'Pad, bass, lead, pluck and keys presets',
    ],
    shot: {
      src: 'screenshots/piano-roll.webp',
      mobileSrc: 'screenshots/piano-roll-mobile.webp',
      alt: 'The piano roll editing two bars of the demo bassline, with the draw tool and 1/16 grid in the toolbar',
      title: 'Piano roll',
    },
  },
  {
    id: 'tune',
    title: 'Record a take and tune it',
    body: 'Nawa detects the notes in a solo vocal, suggests the key, and lets you correct pitch note by note or automatically.',
    points: [
      'Key and scale suggestion with alternatives',
      'Auto Tune strength and humanize controls',
      'A/B the corrected take against the original',
    ],
    note: 'Designed for solo vocals, one voice at a time. Large pitch moves can sound processed.',
    shot: {
      src: 'screenshots/vocal-editor.webp',
      mobileSrc: 'screenshots/vocal-editor-mobile.webp',
      alt: 'The vocal pitch editor with detected notes, the suggested key of A minor, and Auto Tune set to 80 percent',
      title: 'Vocal pitch editor',
    },
  },
  {
    id: 'play',
    title: 'Play it on a controller',
    body: 'Connect an AKAI Professional MPK Mini MK3 over USB. Keys, pads and knobs are mapped for you, with soft takeover and MIDI Learn for anything else.',
    points: [
      'On-screen controller lights up as you play',
      'MIDI Learn for any control',
      'Diagnostics for incoming messages',
    ],
    note: 'Mappings come from published documentation and community research and have not yet been verified on a physical unit. Web MIDI needs Chrome or Edge, or Firefox with an add-on.',
    shot: {
      src: 'screenshots/controller.webp',
      mobileSrc: 'screenshots/controller-mobile.webp',
      alt: "Nawa's controller panel: an original drawing of the MPK Mini MK3 layout, with the selected knob's default message and how well it is documented",
      title: 'Controller',
    },
  },
];

/**
 * One step: copy on top, the screenshot underneath. The screenshot scales up and brightens
 * as it travels into the middle of the viewport (scroll-linked, transform and opacity only).
 */
function WorkflowStep({ step, index }: { step: Step; index: number }) {
  const shotRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: shotRef,
    offset: ['start end', 'center center'],
  });
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [0.5, 1]);

  return (
    <li className="relative pl-12 sm:pl-20">
      <Reveal className="absolute top-0 left-0">
        <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-ink font-mono text-xs text-accent-strong shadow-[0_0_0_6px_var(--color-ink)] sm:size-11 sm:text-sm">
          {String(index + 1).padStart(2, '0')}
        </span>
      </Reveal>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
        <Reveal>
          <h3 className="text-2xl font-semibold tracking-[-0.02em] text-balance text-text sm:text-3xl">
            {step.title}
          </h3>
          <p className="mt-3 text-base leading-relaxed text-pretty text-text-muted">{step.body}</p>
        </Reveal>
        <Reveal delay={0.1}>
          <ul className="grid gap-2.5">
            {step.points.map((point) => (
              <li key={point} className="flex gap-3 text-[15px] leading-relaxed text-text">
                <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-success" />
                {point}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
      <motion.div
        ref={shotRef}
        className="mt-8 origin-top sm:mt-10"
        style={reduce ? undefined : { scale, opacity }}
      >
        <ScreenshotFrame
          src={step.shot.src}
          mobileSrc={step.shot.mobileSrc}
          alt={step.shot.alt}
          title={step.shot.title}
        />
      </motion.div>
      {/* Caveats sit under the picture, quieter than the benefits they qualify. */}
      {step.note ? (
        <p className="mt-4 flex max-w-2xl gap-2.5 text-[13px] leading-relaxed text-text-muted">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{step.note}</span>
        </p>
      ) : null}
    </li>
  );
}

export function Workflow() {
  const listRef = useRef<HTMLOListElement>(null);
  const reduce = useReducedMotion();
  // The rail beside the steps fills as you read down the section.
  const { scrollYProgress } = useScroll({ target: listRef, offset: ['start 0.6', 'end 0.6'] });
  const fill = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 });
  // The rail runs from the first step's badge to the last one's and stops there, so it
  // reads as one track rather than a line trailing off past the final step.
  const [railHeight, setRailHeight] = useState(0);
  // The part of the list's scroll range that the rail spans (updated from the measurement).
  const railShare = useMotionValue(1);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const last = list.lastElementChild;
      if (last instanceof HTMLElement && list.offsetHeight > 0) {
        setRailHeight(last.offsetTop);
        railShare.set(Math.max(0.05, last.offsetTop / list.offsetHeight));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [railShare]);
  // Scroll progress covers the whole list; the fill completes as the last badge is reached.
  const scaleY = useTransform([fill, railShare], ([v = 0, share = 1]: number[]) =>
    Math.min(1, v / share),
  );

  return (
    <section
      id="workflow"
      aria-labelledby="workflow-title"
      className="relative scroll-mt-20 border-t border-white/[0.06] py-16 sm:py-24 lg:py-28"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(50%_100%_at_50%_0%,rgb(139_124_246/0.10),transparent)]"
      />
      <Container className="relative">
        <Reveal>
          <SectionHeader
            id="workflow-title"
            eyebrow="Workflow"
            title="From first note to final take"
          >
            <p>
              The tools you reach for once the idea is down: a piano roll for parts, a pitch editor
              for vocals, and a hardware controller when you want to play.
            </p>
          </SectionHeader>
        </Reveal>

        <div className="relative mt-12 sm:mt-16">
          <div
            aria-hidden="true"
            className="absolute top-4 left-[17px] w-px bg-white/[0.12] sm:top-5 sm:left-[21px]"
            style={{ height: railHeight }}
          >
            <motion.div
              className="h-full w-full origin-top bg-gradient-to-b from-accent-strong via-accent to-success"
              style={reduce ? undefined : { scaleY }}
            />
          </div>
          <ol ref={listRef} className="relative grid gap-20 sm:gap-28">
            {STEPS.map((step, i) => (
              <WorkflowStep key={step.id} step={step} index={i} />
            ))}
          </ol>
        </div>

        <Reveal className="mt-14 flex flex-wrap gap-2 pl-12 sm:pl-20">
          <Pill tone="accent">Non-destructive edits</Pill>
          <Pill>Undo and redo</Pill>
          <Pill>Keyboard shortcuts</Pill>
        </Reveal>
      </Container>
    </section>
  );
}
