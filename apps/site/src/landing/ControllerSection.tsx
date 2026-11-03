import { MpkMiniPanel, mpkKeyNoteName } from '@studio/react/mpk';
import { Cable, Radar, SlidersHorizontal } from 'lucide-react';
import {
  motion,
  useInView,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
import { useCallback, useEffect, useRef } from 'react';
import { MpkVoices } from './mpk-voices';
import { Container, SectionHeader } from './primitives';
import { Reveal, StaggerItem, StaggerList } from './reveal';

const PAD_SOUNDS = ['Kick', 'Snare', 'Hat', 'Clap', 'Tom', 'Rim', 'Open hat', 'Perc'];

/** How far each knob turns (degrees) over the section's scroll, so they don't move in unison. */
const KNOB_SWEEP = [150, 95, 210, 60, 180, 120, 240, 80];

/** Lit once when the device first scrolls into view: a C major arpeggio and a pad roll. */
const INTRO: readonly (readonly [layoutId: string, atMs: number])[] = [
  ['key.0', 0],
  ['key.4', 140],
  ['key.7', 280],
  ['key.12', 420],
  ['pad.1', 640],
  ['pad.2', 720],
  ['pad.3', 800],
  ['pad.4', 880],
  ['pad.8', 1020],
  ['pad.7', 1100],
  ['pad.6', 1180],
  ['pad.5', 1260],
];

const FACTS = [
  {
    icon: Radar,
    title: 'Found when you plug it in',
    body: 'Nawa spots the MPK Mini MK3 over Web MIDI and sets it up. No driver, no setup screen.',
  },
  {
    icon: Cable,
    title: 'Keys, pads and knobs, mapped',
    body: 'Keys play the selected track, pads play drums, and the eight knobs drive its sound.',
  },
  {
    icon: SlidersHorizontal,
    title: 'MIDI Learn anything else',
    body: 'Right-click any control in Nawa, turn a knob, and it is mapped. A live view shows every move.',
  },
] as const;

function describe(layoutId: string): string {
  const [kind, index] = layoutId.split('.');
  const n = Number(index);
  if (kind === 'key') return `NOTE ${mpkKeyNoteName(layoutId)}${3 + Math.floor(n / 12)}`;
  return `PAD ${n} · ${(PAD_SOUNDS[n - 1] ?? '').toUpperCase()}`;
}

/**
 * "Bring your controller": the MPK mini drawing from the Studio, playable here (keys are a soft
 * synth, pads a small drum kit). It tilts flat as it scrolls in, its knobs turn with the scroll,
 * and it lights a short pattern the first time it is seen. Live states are written straight to
 * the SVG, so pressing keys never re-renders React.
 */
export function ControllerSection() {
  const reduce = useReducedMotion();
  const frameRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, SVGGElement>());
  const oledRef = useRef<SVGTextElement>(null);
  const voices = useRef<MpkVoices | null>(null);
  const inView = useInView(frameRef, { once: true, amount: 0.45 });

  const { scrollYProgress } = useScroll({
    target: frameRef,
    offset: ['start end', 'end start'],
  });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  const rotateX = useTransform(progress, [0, 0.45], [32, 0]);
  const scale = useTransform(progress, [0, 0.45], [0.9, 1]);
  const lift = useTransform(progress, [0, 0.45], [60, 0]);

  // Knobs follow the scroll position.
  useMotionValueEvent(progress, 'change', (v) => {
    if (reduce) return;
    for (let i = 0; i < KNOB_SWEEP.length; i++) {
      const indicator = nodes.current.get(`knob.K${i + 1}`)?.querySelector('[data-indicator]');
      indicator?.setAttribute('transform', `rotate(${-135 + v * (KNOB_SWEEP[i] ?? 0)})`);
    }
  });

  const light = useCallback((layoutId: string, on: boolean) => {
    const node = nodes.current.get(layoutId);
    if (node) node.dataset.active = on ? 'true' : 'false';
  }, []);

  useEffect(() => {
    if (!inView || reduce) return;
    const timers = INTRO.flatMap(([id, at]) => [
      window.setTimeout(() => light(id, true), at),
      window.setTimeout(() => light(id, false), at + 220),
    ]);
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [inView, reduce, light]);

  useEffect(() => () => voices.current?.dispose(), []);

  const onPress = useCallback(
    (layoutId: string, down: boolean) => {
      light(layoutId, down);
      voices.current ??= new MpkVoices();
      if (down) {
        voices.current.press(layoutId);
        if (oledRef.current) oledRef.current.textContent = describe(layoutId);
      } else {
        voices.current.release(layoutId);
      }
    },
    [light],
  );

  const register = useCallback((id: string, node: SVGGElement | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  return (
    <section
      id="controller"
      aria-labelledby="controller-title"
      className="relative scroll-mt-20 overflow-hidden border-t border-white/[0.06] py-16 sm:py-24 lg:py-28"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[58%] left-1/2 h-[620px] w-[1100px] max-w-none -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(139_124_246/0.18),transparent)]"
      />
      <Container className="relative">
        <Reveal>
          <SectionHeader
            id="controller-title"
            eyebrow="MIDI controller"
            title="Plug in your MPK mini. It just plays."
            align="center"
          >
            <p>Nawa knows the AKAI MPK Mini MK3 by heart. Try this one: press the keys and pads.</p>
          </SectionHeader>
        </Reveal>

        <div ref={frameRef} className="mx-auto mt-12 max-w-5xl [perspective:1800px] sm:mt-16">
          <motion.div
            style={reduce ? undefined : { rotateX, scale, y: lift, transformOrigin: '50% 100%' }}
            className="relative"
          >
            <div
              aria-hidden="true"
              className="absolute inset-x-[6%] -bottom-6 h-12 rounded-[50%] bg-black/70 blur-2xl"
            />
            <MpkMiniPanel
              label="A playable MPK Mini MK3. Press the keys for a synth and the pads for drums."
              className="relative w-full touch-none drop-shadow-[0_30px_50px_rgba(0,0,0,0.55)] select-none"
              testId="landing-mpk"
              onPress={onPress}
              registerNode={register}
              oledRef={oledRef}
              oledText="Tap a key or pad"
            />
          </motion.div>
        </div>

        <StaggerList className="mx-auto mt-14 grid max-w-5xl gap-4 sm:grid-cols-3">
          {FACTS.map(({ icon: Icon, title, body }) => (
            <StaggerItem
              key={title}
              className="nawa-hairline rounded-2xl bg-white/[0.02] p-5 transition-colors duration-300 hover:bg-white/[0.04]"
            >
              <Icon aria-hidden="true" className="size-5 text-accent-strong" />
              <h3 className="mt-3 text-[15px] font-semibold text-text">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{body}</p>
            </StaggerItem>
          ))}
        </StaggerList>
      </Container>
    </section>
  );
}
