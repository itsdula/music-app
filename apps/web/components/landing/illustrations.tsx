/*
 * Decorative, original SVG illustrations that evoke Studio's editors. They are drawn from
 * simple shapes and deterministic pseudo-random data so they render identically on the
 * server and never pass for real screenshots (see ScreenshotFrame for those).
 */

/** Deterministic hash noise in [0, 1). */
function noise(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const f = (n: number) => n.toFixed(1);

const C = {
  surface0: 'var(--color-surface-0)',
  surface1: 'var(--color-surface-1)',
  surface2: 'var(--color-surface-2)',
  surface3: 'var(--color-surface-3)',
  line: 'var(--color-line)',
  lineStrong: 'var(--color-line-strong)',
  text: 'var(--color-text)',
  muted: 'var(--color-text-muted)',
  faint: 'var(--color-text-faint)',
  accent: 'var(--color-accent)',
  accentStrong: 'var(--color-accent-strong)',
  record: 'var(--color-record)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
} as const;

/** Vertical-bar waveform path inside a box. */
function waveformPath(x: number, y: number, w: number, h: number, seed: number, step = 3): string {
  const mid = y + h / 2;
  let d = '';
  for (let px = 0; px < w; px += step) {
    const t = px / w;
    const envelope = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.6;
    const amp = (0.25 + 0.75 * noise(seed * 101 + px)) * envelope * (h / 2 - 1);
    d += `M${f(x + px)} ${f(mid - amp)}V${f(mid + amp)}`;
  }
  return d;
}

/* ------------------------------------------------------------------------------------ */
/* Arrangement                                                                          */
/* ------------------------------------------------------------------------------------ */

type ClipKind = 'audio' | 'midi';
interface Clip {
  start: number;
  length: number;
  kind: ClipKind;
}

const LANES: { color: string; clips: Clip[] }[] = [
  {
    color: C.accent,
    clips: [
      { start: 0, length: 160, kind: 'midi' },
      { start: 168, length: 160, kind: 'midi' },
      { start: 336, length: 160, kind: 'midi' },
    ],
  },
  {
    color: C.success,
    clips: [
      { start: 0, length: 240, kind: 'midi' },
      { start: 256, length: 240, kind: 'midi' },
    ],
  },
  {
    color: C.warning,
    clips: [
      { start: 80, length: 200, kind: 'midi' },
      { start: 336, length: 120, kind: 'midi' },
    ],
  },
  {
    color: C.record,
    clips: [
      { start: 40, length: 220, kind: 'audio' },
      { start: 288, length: 190, kind: 'audio' },
    ],
  },
  { color: C.accentStrong, clips: [{ start: 168, length: 328, kind: 'audio' }] },
];

function midiDashes(x: number, y: number, w: number, h: number, seed: number) {
  const dashes: { x: number; y: number; w: number }[] = [];
  for (let px = 6, i = 0; px < w - 10; i++) {
    const len = 8 + Math.round(noise(seed * 7 + i) * 3) * 6;
    const row = Math.floor(noise(seed * 13 + i * 3) * 5);
    dashes.push({ x: x + px, y: y + 4 + row * ((h - 10) / 5), w: Math.min(len, w - px - 6) });
    px += len + 4;
  }
  return dashes;
}

export function ArrangementIllustration({ className }: { className?: string }) {
  const W = 640;
  const header = 104;
  const laneTop = 44;
  const laneH = 52;
  const gap = 8;
  const H = laneTop + LANES.length * (laneH + gap) + 12;
  const gridX = (n: number) => header + n;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Illustration of a multitrack arrangement: five tracks of coloured clips on a timeline with a playhead."
      className={className}
    >
      <rect
        x="0.5"
        y="0.5"
        width={W - 1}
        height={H - 1}
        rx="16"
        fill={C.surface1}
        stroke={C.line}
      />
      {/* Ruler */}
      <path d={`M${header} 32H${W - 16}`} stroke={C.line} />
      {Array.from({ length: 32 }, (_, i) => {
        const x = gridX(i * 16);
        if (x > W - 16) return null;
        const bar = i % 4 === 0;
        return (
          <path
            key={i}
            d={`M${x} ${bar ? 14 : 24}V32`}
            stroke={bar ? C.lineStrong : C.line}
            strokeWidth={bar ? 1.5 : 1}
          />
        );
      })}
      <rect x={gridX(168)} y="8" width="160" height="8" rx="4" fill={C.accent} opacity="0.35" />
      {/* Bar grid */}
      {Array.from({ length: 8 }, (_, i) => (
        <path
          key={i}
          d={`M${gridX(i * 64)} ${laneTop - 4}V${H - 12}`}
          stroke={C.line}
          strokeDasharray="2 4"
          opacity="0.7"
        />
      ))}
      {LANES.map((lane, li) => {
        const y = laneTop + li * (laneH + gap);
        return (
          <g key={li}>
            {/* Track header */}
            <rect x="12" y={y} width={header - 24} height={laneH} rx="8" fill={C.surface2} />
            <rect x="12" y={y} width="4" height={laneH} rx="2" fill={lane.color} />
            <rect
              x="26"
              y={y + 14}
              width={36 + (li % 3) * 8}
              height="6"
              rx="3"
              fill={C.muted}
              opacity="0.55"
            />
            <rect x="26" y={y + 30} width="12" height="8" rx="2" fill={C.surface3} />
            <rect x="42" y={y + 30} width="12" height="8" rx="2" fill={C.surface3} />
            {li === 3 ? <circle cx="64" cy={y + 34} r="4" fill={C.record} /> : null}
            {/* Clips */}
            {lane.clips.map((clip, ci) => {
              const x = gridX(clip.start);
              const w = Math.min(clip.length, W - 16 - x);
              const seed = li * 10 + ci + 1;
              return (
                <g key={ci}>
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={laneH}
                    rx="7"
                    fill={lane.color}
                    fillOpacity="0.14"
                    stroke={lane.color}
                    strokeOpacity="0.55"
                  />
                  <rect
                    x={x + 6}
                    y={y + 5}
                    width={Math.min(48, w - 12)}
                    height="4"
                    rx="2"
                    fill={lane.color}
                    opacity="0.7"
                  />
                  {clip.kind === 'audio' ? (
                    <path
                      d={waveformPath(x + 6, y + 14, w - 12, laneH - 20, seed)}
                      stroke={lane.color}
                      strokeOpacity="0.85"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  ) : (
                    midiDashes(x, y + 14, w, laneH - 18, seed).map((d, di) => (
                      <rect
                        key={di}
                        x={d.x}
                        y={d.y}
                        width={d.w}
                        height="4"
                        rx="2"
                        fill={lane.color}
                        opacity="0.85"
                      />
                    ))
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
      {/* Playhead */}
      <g className="landing-playhead">
        <path d={`M${gridX(200)} 14V${H - 12}`} stroke={C.text} strokeWidth="1.5" opacity="0.9" />
        <path d={`M${gridX(200) - 6} 8h12l-6 8z`} fill={C.text} />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------------------------ */
/* Piano roll                                                                           */
/* ------------------------------------------------------------------------------------ */

const ROLL_NOTES: [start: number, length: number, row: number, velocity: number][] = [
  [0, 3, 7, 0.9],
  [0, 3, 4, 0.7],
  [0, 3, 0, 0.75],
  [4, 2, 6, 0.6],
  [6, 2, 5, 0.8],
  [8, 3, 8, 0.95],
  [8, 3, 3, 0.65],
  [12, 1, 6, 0.5],
  [13, 1, 7, 0.55],
  [14, 2, 9, 0.85],
  [16, 3, 7, 0.9],
  [16, 3, 2, 0.6],
  [20, 2, 5, 0.7],
  [22, 2, 4, 0.75],
];

export function PianoRollIllustration({ className }: { className?: string }) {
  const W = 420;
  const rows = 11;
  const rowH = 12;
  const keyW = 28;
  const step = 15;
  const top = 8;
  const gridH = rows * rowH;
  const velTop = top + gridH + 10;
  const H = velTop + 34;
  const black = new Set([1, 3, 6, 8, 10]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Illustration of a piano roll with chords and a melody, and velocity bars below."
      className={className}
    >
      {Array.from({ length: rows }, (_, r) => (
        <g key={r}>
          <rect
            x={keyW + 4}
            y={top + r * rowH}
            width={W - keyW - 4}
            height={rowH}
            fill={black.has(r) ? C.surface0 : C.surface2}
            opacity={black.has(r) ? 0.6 : 0.5}
          />
          <rect
            x="0"
            y={top + r * rowH + 0.5}
            width={black.has(r) ? keyW * 0.6 : keyW}
            height={rowH - 1}
            rx="2"
            fill={black.has(r) ? C.surface3 : C.muted}
            opacity={black.has(r) ? 1 : 0.35}
          />
        </g>
      ))}
      {Array.from({ length: 26 }, (_, i) => (
        <path
          key={i}
          d={`M${keyW + 4 + i * step} ${top}V${top + gridH}`}
          stroke={C.line}
          opacity={i % 4 === 0 ? 1 : 0.4}
        />
      ))}
      {ROLL_NOTES.map(([s, l, r, v], i) => (
        <g key={i}>
          <rect
            x={keyW + 5 + s * step}
            y={top + (rows - 1 - r) * rowH + 1.5}
            width={l * step - 2}
            height={rowH - 3}
            rx="2.5"
            fill={C.accent}
            fillOpacity={0.45 + v * 0.5}
            stroke={C.accentStrong}
            strokeOpacity="0.6"
          />
          <path
            d={`M${keyW + 6 + s * step} ${velTop + 30}V${f(velTop + 30 - v * 26)}`}
            stroke={C.accent}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle
            cx={keyW + 6 + s * step}
            cy={f(velTop + 30 - v * 26)}
            r="2.5"
            fill={C.accentStrong}
          />
        </g>
      ))}
      <path d={`M${keyW + 4} ${velTop - 4}H${W}`} stroke={C.line} />
    </svg>
  );
}

/* ------------------------------------------------------------------------------------ */
/* Controller (deliberately simplified, original geometry; not a product drawing)       */
/* ------------------------------------------------------------------------------------ */

export function ControllerIllustration({ className }: { className?: string }) {
  const W = 640;
  const H = 330;
  const whiteCount = 15;
  const kbX = 24;
  const kbY = 176;
  const kbW = W - 48;
  const kbH = 130;
  const whiteW = kbW / whiteCount;
  // Black keys follow the white key after which they sit (C#, D#, F#, G#, A#).
  const blackAfter = [0, 1, 3, 4, 5];
  const litWhite = new Set([2, 4, 7]);
  const litPads = [1, 6];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Simplified illustration of a compact MIDI keyboard controller: 25 keys, eight pads, eight knobs and a joystick, with some keys and pads lit as if being played."
      className={className}
    >
      <rect
        x="0.5"
        y="0.5"
        width={W - 1}
        height={H - 1}
        rx="22"
        fill={C.surface1}
        stroke={C.line}
      />
      {/* Joystick */}
      <circle cx="64" cy="64" r="30" fill={C.surface0} stroke={C.line} />
      <circle cx="70" cy="58" r="12" fill={C.surface3} stroke={C.lineStrong} />
      {/* Display + buttons */}
      <rect x="22" y="112" width="84" height="40" rx="6" fill={C.surface0} stroke={C.line} />
      <rect x="32" y="124" width="44" height="5" rx="2.5" fill={C.accent} opacity="0.8" />
      <rect x="32" y="135" width="28" height="5" rx="2.5" fill={C.muted} opacity="0.5" />
      {Array.from({ length: 4 }, (_, i) => (
        <rect
          key={i}
          x={124}
          y={30 + i * 32}
          width="34"
          height="16"
          rx="4"
          fill={C.surface2}
          stroke={C.line}
        />
      ))}
      {/* Pads 2×4 */}
      {Array.from({ length: 8 }, (_, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const x = 182 + col * 62;
        const y = 24 + row * 66;
        const lit = litPads.includes(i);
        return (
          <g key={i}>
            <rect x={x} y={y} width="54" height="56" rx="8" fill={C.surface2} stroke={C.line} />
            <rect
              x={x}
              y={y}
              width="54"
              height="56"
              rx="8"
              fill={C.accent}
              className={lit ? 'landing-pad' : undefined}
              style={lit ? { animationDelay: `${i * 0.45}s` } : undefined}
              opacity={lit ? 0.55 : 0}
            />
          </g>
        );
      })}
      {/* Knobs 2×4 */}
      {Array.from({ length: 8 }, (_, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const cx = 456 + col * 46;
        const cy = 50 + row * 66;
        const angle = -135 + noise(i + 3) * 270;
        const rad = (angle * Math.PI) / 180;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r="17" fill={C.surface0} stroke={C.line} />
            <circle cx={cx} cy={cy} r="12" fill={C.surface3} />
            <path
              d={`M${cx} ${cy}L${f(cx + Math.sin(rad) * 11)} ${f(cy - Math.cos(rad) * 11)}`}
              stroke={i === 2 ? C.accentStrong : C.text}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </g>
        );
      })}
      {/* Keys */}
      <rect x={kbX - 4} y={kbY - 4} width={kbW + 8} height={kbH + 8} rx="10" fill={C.surface0} />
      {Array.from({ length: whiteCount }, (_, i) => (
        <rect
          key={i}
          x={f(kbX + i * whiteW + 1)}
          y={kbY}
          width={f(whiteW - 2)}
          height={kbH}
          rx="4"
          fill={litWhite.has(i) ? C.accent : C.text}
          opacity={litWhite.has(i) ? 0.95 : 0.88}
        />
      ))}
      {Array.from({ length: 2 }, (_, octave) =>
        blackAfter.map((w) => {
          const idx = octave * 7 + w;
          return (
            <rect
              key={`${octave}-${w}`}
              x={f(kbX + (idx + 1) * whiteW - whiteW * 0.3)}
              y={kbY}
              width={f(whiteW * 0.6)}
              height={kbH * 0.6}
              rx="3"
              fill={idx === 8 ? C.accentStrong : C.surface1}
            />
          );
        }),
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------------------------ */
/* Vocal pitch editor                                                                   */
/* ------------------------------------------------------------------------------------ */

const PITCH_ROWS = ['E4', 'D♯4', 'D4', 'C♯4', 'C4', 'B3', 'A♯3', 'A3'];

interface VocalNote {
  x0: number;
  x1: number;
  row: number;
  /** Row the note was detected on before the user moved it. */
  fromRow?: number;
  /** Detected offset from the row centre in rows (e.g. a flat note). */
  detune?: number;
  vibrato?: number;
}

const VOCAL_NOTES: VocalNote[] = [
  { x0: 70, x1: 160, row: 7, detune: 0.05 },
  { x0: 172, x1: 240, row: 4, detune: 0.2, vibrato: 0.08 },
  { x0: 252, x1: 300, row: 5, detune: -0.1 },
  { x0: 312, x1: 440, row: 2, fromRow: 3, vibrato: 0.14 },
  { x0: 456, x1: 600, row: 0, detune: 0.12, vibrato: 0.12 },
];

export function PitchEditorIllustration({ className }: { className?: string }) {
  const W = 620;
  const top = 12;
  const rowH = 26;
  const gridH = PITCH_ROWS.length * rowH;
  const waveTop = top + gridH + 18;
  const H = waveTop + 64;
  const rowY = (row: number) => top + row * rowH + rowH / 2;

  // One continuous contour across all notes, with drift and vibrato inside each note.
  let contour = '';
  VOCAL_NOTES.forEach((n) => {
    for (let x = n.x0; x <= n.x1; x += 3) {
      const t = (x - n.x0) / (n.x1 - n.x0);
      const scoop = (1 - Math.min(1, t * 5)) * 0.35;
      const vib = (n.vibrato ?? 0.03) * Math.sin(x / 4.5) * Math.min(1, t * 2);
      const y = rowY(n.row) + ((n.detune ?? 0) + scoop + vib) * rowH;
      contour += `${contour === '' ? 'M' : 'L'}${f(x)} ${f(y)}`;
    }
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Illustration of a vocal pitch editor: detected notes as blocks on a pitch grid, a pitch curve running through them, one note moved up a semitone, and the vocal waveform below."
      className={className}
    >
      <rect
        x="0.5"
        y="0.5"
        width={W - 1}
        height={H - 1}
        rx="16"
        fill={C.surface1}
        stroke={C.line}
      />
      {PITCH_ROWS.map((name, r) => (
        <g key={name}>
          <rect
            x="52"
            y={top + r * rowH}
            width={W - 64}
            height={rowH}
            fill={name.includes('♯') ? C.surface0 : C.surface2}
            opacity={name.includes('♯') ? 0.55 : 0.35}
          />
          <text
            x="40"
            y={rowY(r) + 4}
            textAnchor="end"
            fontSize="11"
            fill={C.muted}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {name}
          </text>
        </g>
      ))}
      {VOCAL_NOTES.map((n, i) => (
        <g key={i}>
          {n.fromRow !== undefined ? (
            <>
              <rect
                x={n.x0}
                y={top + n.fromRow * rowH + 3}
                width={n.x1 - n.x0}
                height={rowH - 6}
                rx="10"
                fill="none"
                stroke={C.muted}
                strokeDasharray="4 4"
                opacity="0.7"
              />
              <path
                d={`M${n.x0 - 14} ${rowY(n.fromRow) - 2}V${rowY(n.row) + 6}`}
                stroke={C.warning}
                strokeWidth="1.5"
              />
              <path d={`M${n.x0 - 18} ${rowY(n.row) + 8}l4 -6l4 6z`} fill={C.warning} />
            </>
          ) : null}
          <rect
            x={n.x0}
            y={top + n.row * rowH + 3}
            width={n.x1 - n.x0}
            height={rowH - 6}
            rx="10"
            fill={n.fromRow !== undefined ? C.warning : C.accent}
            fillOpacity="0.22"
            stroke={n.fromRow !== undefined ? C.warning : C.accent}
            strokeOpacity="0.7"
          />
        </g>
      ))}
      <path
        d={contour}
        fill="none"
        stroke={C.text}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
      {/* Waveform */}
      <rect x="52" y={waveTop} width={W - 64} height="48" rx="8" fill={C.surface0} />
      {VOCAL_NOTES.map((n, i) => (
        <path
          key={i}
          d={waveformPath(n.x0, waveTop + 4, n.x1 - n.x0, 40, i + 40, 2.5)}
          stroke={C.accentStrong}
          strokeOpacity="0.7"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
