/**
 * Original geometric model of the MPK Mini MK3 top panel for hardware-style views.
 *
 * Derived from the proportions measured in docs/midi-device-research.md §6 (±0.01) and
 * regularised: round controls are drawn square in physical units (h = w × aspect ratio),
 * grids use uniform pitches. No photo, logo, wordmark or traced artwork is used — the
 * renderer draws plain shapes and the text legends below. Brand marks are intentionally
 * absent (the dossier's logo band is left empty).
 */
import type { DeviceLayout, DeviceLayoutElement, LayoutRect } from '@studio/midi-core';

/** Official footprint 12.5" × 7.13" (DOC-EXCERPT) ≈ 1.75 : 1. */
export const MPK_MINI_MK3_ASPECT_RATIO = 12.5 / 7.13;

const round = (v: number): number => Math.round(v * 10_000) / 10_000;
const rect = (x: number, y: number, w: number, h: number): LayoutRect => ({
  x: round(x),
  y: round(y),
  w: round(w),
  h: round(h),
});
/** A rect that is square on the physical panel. */
const square = (x: number, y: number, w: number): LayoutRect =>
  rect(x, y, w, w * MPK_MINI_MK3_ASPECT_RATIO);

const button = (
  controlId: string,
  legend: string,
  x: number,
  y: number,
  w = 0.044,
  h = 0.05,
): DeviceLayoutElement => ({ controlId, rect: rect(x, y, w, h), shape: 'button', legend });

const LEFT_COLUMN = [0.03, 0.089] as const;
const LEFT_ROWS = [0.225, 0.298, 0.37] as const;

const leftButtons: DeviceLayoutElement[] = [
  button('button.arpOnOff', 'ON/OFF', LEFT_COLUMN[0], LEFT_ROWS[0]),
  button('button.tapTempo', 'TAP TEMPO', LEFT_COLUMN[1], LEFT_ROWS[0]),
  button('button.octaveDown', 'OCT -', LEFT_COLUMN[0], LEFT_ROWS[1]),
  button('button.octaveUp', 'OCT +', LEFT_COLUMN[1], LEFT_ROWS[1]),
  button('button.fullLevel', 'FULL LEVEL', LEFT_COLUMN[0], LEFT_ROWS[2]),
  button('button.noteRepeat', 'NOTE REPEAT', LEFT_COLUMN[1], LEFT_ROWS[2]),
];

const topRightButtons: DeviceLayoutElement[] = [
  button('button.bankAB', 'BANK A/B', 0.75, 0.08),
  button('button.padCC', 'CC', 0.805, 0.08),
  button('button.padProgramChange', 'PROG CHANGE', 0.86, 0.08),
  button('button.programSelect', 'PROG SELECT', 0.916, 0.08),
];

const PAD_X0 = 0.17;
const PAD_PITCH_X = 0.1093;
const PAD_W = 0.09;
const PAD_ROWS = { top: 0.058, bottom: 0.256 } as const;

/** Physical pads 1–8: bottom row 1–4, top row 5–8 (as printed). */
const pads: DeviceLayoutElement[] = Array.from({ length: 8 }, (_, i) => {
  const pad = i + 1;
  const column = i % 4;
  const y = pad <= 4 ? PAD_ROWS.bottom : PAD_ROWS.top;
  return {
    controlId: `pad.${pad}`,
    rect: square(PAD_X0 + column * PAD_PITCH_X, y, PAD_W),
    shape: 'pad',
    legend: `PAD ${pad}`,
  };
});

const KNOB_X0 = 0.621;
const KNOB_PITCH_X = 0.0943;
const KNOB_W = 0.058;
const KNOB_ROWS = [0.172, 0.339] as const;

const knobs: DeviceLayoutElement[] = Array.from({ length: 8 }, (_, i) => ({
  controlId: `knob.K${i + 1}`,
  rect: square(KNOB_X0 + (i % 4) * KNOB_PITCH_X, KNOB_ROWS[i < 4 ? 0 : 1], KNOB_W),
  shape: 'knob',
  legend: `K${i + 1}`,
}));

/**
 * Printed key legends (arpeggiator/note-repeat settings used while holding ARP ON/OFF or
 * NOTE REPEAT), left to right. Read from a low-resolution photo: the exact key-to-legend
 * alignment is UNVERIFIED (§3).
 */
export const MPK_MINI_MK3_KEY_LEGENDS: readonly string[] = [
  '1/4',
  '1/4T',
  '1/8',
  '1/8T',
  '1/16',
  '1/16T',
  '1/32',
  '1/32T',
  'UP',
  'DOWN',
  'EXCL',
  'INCL',
  'ORDER',
  'RAND',
  'LATCH',
  'ARP OCT 1',
  'ARP OCT 2',
  'ARP OCT 3',
  'ARP OCT 4',
  'SWING 50%',
  'SWING 55%',
  'SWING 57%',
  'SWING 59%',
  'SWING 61%',
  'SWING 64%',
];

const KEYBED = { x: 0.037, y: 0.528, w: 0.924, h: 0.467 } as const;
const WHITE_COUNT = 15;
const WHITE_W = KEYBED.w / WHITE_COUNT;
const BLACK_W = WHITE_W * 0.6;
const BLACK_H = KEYBED.h * 0.58;
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

const keys: DeviceLayoutElement[] = [];
{
  let whiteIndex = 0;
  for (let semitone = 0; semitone < 25; semitone++) {
    const inOctave = semitone % 12;
    const secondaryLegend = MPK_MINI_MK3_KEY_LEGENDS[semitone];
    const common = {
      controlId: `key.${semitone}`,
      ...(secondaryLegend !== undefined ? { secondaryLegend } : {}),
    };
    if (WHITE_SEMITONES.includes(inOctave)) {
      keys.push({
        ...common,
        rect: rect(KEYBED.x + whiteIndex * WHITE_W, KEYBED.y, WHITE_W, KEYBED.h),
        shape: 'key-white',
      });
      whiteIndex++;
    } else {
      keys.push({
        ...common,
        rect: rect(KEYBED.x + whiteIndex * WHITE_W - BLACK_W / 2, KEYBED.y, BLACK_W, BLACK_H),
        shape: 'key-black',
      });
    }
  }
}

const display: DeviceLayoutElement = {
  controlId: 'display.oled',
  rect: rect(0.608, 0.055, 0.118, 0.085),
  shape: 'display',
};

const joystick: DeviceLayoutElement = {
  controlId: 'joystick',
  rect: square(0.047, 0.058, 0.065),
  shape: 'joystick',
};

export const MPK_MINI_MK3_LAYOUT: DeviceLayout = {
  aspectRatio: MPK_MINI_MK3_ASPECT_RATIO,
  elements: [joystick, ...leftButtons, ...pads, display, ...topRightButtons, ...knobs, ...keys],
  referenceNote:
    'Original geometric model derived from the proportions in docs/midi-device-research.md ' +
    '§6 (measured ±0.01 from a reference photo that is NOT shipped or traced). Coordinates ' +
    'are fractions of the top panel incl. side cheeks, origin top-left. Round controls are ' +
    'square in physical units at the official 1.75:1 footprint. Brand marks are omitted on ' +
    'purpose. Knob secondary legends are illegible in the reference and therefore omitted; ' +
    'key legend alignment is unverified. Re-check against the official manual diagram.',
};

/** Printed group legends drawn above related buttons (not controls). */
export const MPK_MINI_MK3_PANEL_LEGENDS: ReadonlyArray<{
  readonly id: string;
  readonly text: string;
  readonly rect: LayoutRect;
}> = [
  { id: 'legend.arpeggiator', text: 'ARPEGGIATOR', rect: rect(0.025, 0.208, 0.112, 0.077) },
  { id: 'legend.padControls', text: 'PAD CONTROLS', rect: rect(0.75, 0.046, 0.154, 0.082) },
];

/**
 * Layout elements that stand for several controls (or none): a physical pad is one
 * control per bank, the joystick has two axes, the OLED sends nothing. Any other layout
 * id is itself a control id.
 */
export const MPK_MINI_MK3_LAYOUT_GROUPS: Readonly<Record<string, readonly string[]>> = {
  joystick: ['joystick.x', 'joystick.y'],
  'display.oled': [],
  ...Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`pad.${i + 1}`, [`pad.A${i + 1}`, `pad.B${i + 1}`]]),
  ),
};

/** Control ids represented by a layout element. */
export function controlIdsForLayoutElement(layoutId: string): readonly string[] {
  return MPK_MINI_MK3_LAYOUT_GROUPS[layoutId] ?? [layoutId];
}
