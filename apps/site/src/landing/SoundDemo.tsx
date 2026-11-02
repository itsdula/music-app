import { Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DemoEngine, PATTERN } from './demo-engine';
import { DemoKnob } from './DemoKnob';
import { Container, SectionHeader, cx, focusRing } from './primitives';
import { Reveal } from './reveal';

/* Knob scales. The knobs hold 0..1; these map that to the sound. */
const CUTOFF_MIN = 80;
const CUTOFF_MAX = 8000;
const cutoffHz = (v: number) => CUTOFF_MIN * (CUTOFF_MAX / CUTOFF_MIN) ** v; // logarithmic
const resonanceQ = (v: number) => 0.5 + v * 14.5;
const volumeDb = (v: number) => -36 + v * 36;

const formatHz = (hz: number) =>
  hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;

const METER_FLOOR_DB = -48;
/** Scale marks drawn beside the meter, in dBFS (the scale is linear in dB). */
const METER_TICKS = [0, -12, -24, -36, -48];
/** How far the bars fall per frame (about 35 dB/s at 60 fps), like a channel meter's release. */
const METER_FALL = 0.012;

/**
 * Shows `level` (0..1) of a meter bar. The bar slides up into view while its gradient
 * slides the other way by the same amount, so the colours stay pinned to the dB scale
 * (green low, amber and red only near 0 dBFS) instead of stretching with the level.
 */
function setBarLevel(bar: HTMLElement, level: number): void {
  const offset = (1 - level) * 100;
  bar.style.transform = `translateY(${offset}%)`;
  const fill = bar.firstElementChild;
  if (fill instanceof HTMLElement) fill.style.transform = `translateY(${-offset}%)`;
}
const levelToScale = (db: number) =>
  Number.isFinite(db) ? Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB)) : 0;

/** Magnitude (dB) of a 2-pole low-pass at `f`, used to draw the response curve. */
function lowpassDb(f: number, fc: number, q: number): number {
  const r = f / fc;
  const mag = 1 / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2);
  return 20 * Math.log10(mag);
}

/** The filter's response as an SVG path (20 Hz..20 kHz on a log axis, -36..+24 dB). */
function responsePath(fc: number, q: number, width: number, height: number): string {
  const points: string[] = [];
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const f = 20 * 1000 ** t;
    const db = Math.max(-36, Math.min(24, lowpassDb(f, fc, q)));
    const x = t * width;
    const y = ((24 - db) / 60) * height;
    points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(' ');
}

/**
 * "Try it": a little synth strip with real knobs, a live stereo meter and a step display.
 * Nothing sounds until the reader presses Play (the click resumes the AudioContext). The
 * meter and the step highlight are written straight to the DOM from one animation frame
 * loop, so React never re-renders per frame; knob moves re-render only this component.
 */
export function SoundDemo() {
  const [cutoff, setCutoff] = useState(0.55);
  const [resonance, setResonance] = useState(0.45);
  const [volume, setVolume] = useState(0.8);
  const [playing, setPlaying] = useState(false);

  const engineRef = useRef<DemoEngine | null>(null);
  const meterRefs = useRef<(HTMLDivElement | null)[]>([]);
  const peakRefs = useRef<(HTMLDivElement | null)[]>([]);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);

  const params = useMemo(
    () => ({
      cutoffHz: cutoffHz(cutoff),
      resonance: resonanceQ(resonance),
      volumeDb: volumeDb(volume),
    }),
    [cutoff, resonance, volume],
  );

  useEffect(() => {
    engineRef.current?.setParams(params);
  }, [params]);

  // Tear the audio graph down when the section unmounts.
  useEffect(() => () => engineRef.current?.dispose(), []);

  // One frame loop while playing: meters (with a slow-falling peak) and the step highlight.
  useEffect(() => {
    if (!playing) return;
    const engine = engineRef.current;
    if (!engine) return;
    // The arrays are stable (only their slots are reassigned by ref callbacks), so the
    // cleanup can hold on to them.
    const meters = meterRefs.current;
    const peakEls = peakRefs.current;
    const steps = stepRefs.current;
    let frame = 0;
    let lastStep = -1;
    const peaks = [0, 0];
    const shown = [0, 0];
    const tick = () => {
      const levels = engine.levels();
      levels.forEach((db, ch) => {
        // Rise instantly, fall at a steady rate, so the bar reads as a level, not flicker.
        const scale = Math.max(levelToScale(db), (shown[ch] ?? 0) - METER_FALL);
        shown[ch] = scale;
        peaks[ch] = Math.max(scale, (peaks[ch] ?? 0) - 0.004);
        const bar = meters[ch];
        const peak = peakEls[ch];
        if (bar) setBarLevel(bar, scale);
        if (peak) peak.style.transform = `translateY(${(1 - (peaks[ch] ?? 0)) * 100}%)`;
      });
      const step = engine.currentStep();
      if (step !== lastStep) {
        steps[lastStep]?.removeAttribute('data-now');
        steps[step]?.setAttribute('data-now', '');
        lastStep = step;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      steps[lastStep]?.removeAttribute('data-now');
      for (const bar of meters) if (bar) setBarLevel(bar, 0);
      for (const peak of peakEls) if (peak) peak.style.transform = 'translateY(100%)';
    };
  }, [playing]);

  const toggle = useCallback(async () => {
    if (!engineRef.current) engineRef.current = new DemoEngine(params);
    const engine = engineRef.current;
    if (engine.playing) {
      engine.stop();
      setPlaying(false);
    } else {
      await engine.start();
      setPlaying(true);
    }
  }, [params]);

  const curve = responsePath(params.cutoffHz, params.resonance, 320, 120);

  return (
    <section
      id="try"
      aria-labelledby="try-title"
      className="relative scroll-mt-20 overflow-hidden border-t border-white/[0.06] py-16 sm:py-24 lg:py-28"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 -z-0 h-[560px] w-[900px] max-w-none -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(139_124_246/0.16),transparent)]"
      />
      <Container className="relative grid items-center gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <Reveal>
          <SectionHeader id="try-title" eyebrow="Try it here" title="Turn a knob. Hear it.">
            <p>
              A small bass synth, right on this page. Press play, then sweep the filter.{' '}
              <span className="pointer-coarse:hidden">
                Drag a knob up or down, or focus it and use the arrow keys; double-click resets it.
              </span>
              <span className="hidden pointer-coarse:inline">
                Drag a knob up or down; double-tap resets it.
              </span>
            </p>
          </SectionHeader>
          <p className="mt-6 text-sm leading-relaxed text-text-muted">
            In Nawa the same kinds of controls drive every instrument, effect and mixer channel, and
            a MIDI controller can move them too.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="nawa-hairline relative overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,#171a21,#0e1015)] p-5 shadow-[0_50px_120px_-50px_rgb(0_0_0/0.9)] sm:p-7">
            {/* Panel header */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={cx(
                    'size-2 rounded-full transition-colors duration-300',
                    playing
                      ? 'nawa-pulse bg-success shadow-[0_0_10px_var(--color-success)]'
                      : 'bg-white/20',
                  )}
                />
                <p className="font-mono text-[11px] tracking-[0.18em] text-text-muted uppercase">
                  Nawa bass &middot; 112 BPM
                </p>
              </div>
              <button
                type="button"
                onClick={() => void toggle()}
                aria-pressed={playing}
                className={cx(
                  'nawa-cta inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium',
                  playing
                    ? 'border border-white/15 bg-white/[0.06] text-text hover:bg-white/[0.1]'
                    : 'bg-text text-ink shadow-[0_8px_30px_-8px_rgb(139_124_246/0.8)] hover:bg-white',
                  focusRing,
                )}
              >
                {playing ? (
                  <Pause aria-hidden="true" className="size-4" />
                ) : (
                  <Play aria-hidden="true" className="size-4" />
                )}
                {playing ? 'Stop' : 'Play'}
                <span className="sr-only"> demo loop</span>
              </button>
            </div>

            <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:gap-5">
              {/* Filter response + knobs */}
              <div className="min-w-0 rounded-2xl border border-white/[0.06] bg-black/25 p-2.5 sm:p-5">
                <svg
                  viewBox="0 0 320 120"
                  preserveAspectRatio="none"
                  className="h-24 w-full sm:h-28"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="nawa-curve-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#8b7cf6" stopOpacity="0.35" />
                      <stop offset="1" stopColor="#8b7cf6" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[0.25, 0.5, 0.75].map((x) => (
                    <line
                      key={x}
                      x1={x * 320}
                      x2={x * 320}
                      y1="0"
                      y2="120"
                      stroke="rgb(255 255 255 / 0.05)"
                    />
                  ))}
                  <line
                    x1="0"
                    x2="320"
                    y1="48"
                    y2="48"
                    stroke="rgb(255 255 255 / 0.08)"
                    strokeDasharray="2 4"
                  />
                  <path d={`${curve} L320,120 L0,120 Z`} fill="url(#nawa-curve-fill)" />
                  <path
                    d={curve}
                    fill="none"
                    stroke="#a397ff"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <div className="mt-4 flex flex-wrap items-start justify-around gap-x-0.5 gap-y-4">
                  <DemoKnob
                    label="Cutoff"
                    value={cutoff}
                    onChange={setCutoff}
                    defaultValue={0.55}
                    format={(v) => formatHz(cutoffHz(v))}
                  />
                  <DemoKnob
                    label="Resonance"
                    value={resonance}
                    onChange={setResonance}
                    defaultValue={0.45}
                    format={(v) => resonanceQ(v).toFixed(1)}
                  />
                  <DemoKnob
                    label="Volume"
                    value={volume}
                    onChange={setVolume}
                    defaultValue={0.8}
                    format={(v) => `${volumeDb(v).toFixed(1)} dB`}
                  />
                </div>
              </div>

              {/* Stereo meter with a dB scale */}
              <div
                role="img"
                aria-label={
                  playing
                    ? 'Stereo level meter, showing the demo loop'
                    : 'Stereo level meter, silent'
                }
                className="flex rounded-2xl border border-white/[0.06] bg-black/25 py-4 pr-2.5 pl-1.5 sm:pr-4 sm:pl-3"
              >
                <div aria-hidden="true" className="flex h-full gap-1.5">
                  <div className="relative mb-[18px] w-[18px] font-mono text-[9px] text-text-muted sm:mr-1 sm:w-6 sm:text-[10px]">
                    {METER_TICKS.map((db) => (
                      <span
                        key={db}
                        className="absolute right-0 -translate-y-1/2 tabular-nums"
                        style={{ top: `${(db / METER_FLOOR_DB) * 100}%` }}
                      >
                        {db}
                      </span>
                    ))}
                  </div>
                  {['L', 'R'].map((ch, i) => (
                    <div key={ch} className="flex w-3 flex-col items-center gap-1.5">
                      <div className="relative w-full flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                        {/* Tick lines behind the bar, matching the labels. */}
                        {METER_TICKS.slice(1, -1).map((db) => (
                          <span
                            key={db}
                            className="absolute inset-x-0 h-px bg-white/[0.1]"
                            style={{ top: `${(db / METER_FLOOR_DB) * 100}%` }}
                          />
                        ))}
                        <div
                          ref={(el) => {
                            meterRefs.current[i] = el;
                          }}
                          className="absolute inset-0 overflow-hidden rounded-full will-change-transform"
                          style={{ transform: 'translateY(100%)' }}
                        >
                          <div
                            className="h-full w-full bg-[linear-gradient(to_top,var(--color-success)_0%,var(--color-success)_70%,var(--color-warning)_88%,var(--color-record)_100%)] will-change-transform"
                            style={{ transform: 'translateY(-100%)' }}
                          />
                        </div>
                        <div
                          ref={(el) => {
                            peakRefs.current[i] = el;
                          }}
                          className="absolute inset-x-0 top-0 h-full will-change-transform"
                          style={{ transform: 'translateY(100%)' }}
                        >
                          <div className="h-0.5 w-full bg-white/80" />
                        </div>
                      </div>
                      <span className="font-mono text-[10px] text-text-muted">{ch}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Step display: which sixteenth is sounding */}
            <ol
              aria-label="Bass pattern, 16 steps"
              className="mt-5 grid grid-cols-8 gap-1.5 sm:grid-cols-16"
            >
              {PATTERN.map((note, i) => (
                <li
                  key={i}
                  ref={(el) => {
                    stepRefs.current[i] = el;
                  }}
                  aria-label={note == null ? `Step ${i + 1}: rest` : `Step ${i + 1}: note`}
                  className={cx(
                    // Notes are filled, rests are outlines; the sounding step gets a bright
                    // border and glow, so the pattern reads before anything plays.
                    'h-7 rounded-md border transition-[background-color,border-color,box-shadow] duration-100 data-[now]:border-white data-[now]:shadow-[0_0_16px_rgb(163_151_255/0.85)] sm:h-9',
                    note == null
                      ? 'border-white/[0.12] bg-transparent data-[now]:bg-white/15'
                      : 'border-accent-strong/50 bg-accent/70 data-[now]:bg-accent-strong',
                    i % 4 === 0 && note == null && 'border-white/20',
                  )}
                />
              ))}
            </ol>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
