import type { TokenDef } from '../registry';
import { ARRANGEMENT_TOKENS } from './arrangement';
import { BROWSER_TOKENS } from './browser';
import { DEVICES_TOKENS } from './devices';
import { HARDWARE_TOKENS } from './hardware';
import { METERS_TOKENS } from './meters';
import { MIXER_TOKENS } from './mixer';
import { NOTICES_TOKENS } from './notices';
import { OVERLAYS_TOKENS } from './overlays';
import { PIANO_ROLL_TOKENS } from './piano-roll';
import { TIMELINE_TOKENS } from './timeline';
import { TRANSPORT_TOKENS } from './transport';
import { VOCAL_EDITOR_TOKENS } from './vocal-editor';
import { WAVEFORM_TOKENS } from './waveform';

export const SET_IDS = [
  'timeline',
  'transport',
  'arrangement',
  'piano-roll',
  'vocal-editor',
  'mixer',
  'meters',
  'devices',
  'browser',
  'waveform',
  'overlays',
  'hardware',
  'notices',
] as const;
export type SetId = (typeof SET_IDS)[number];

export const SET_DEFS: Readonly<Record<SetId, readonly TokenDef[]>> = {
  timeline: TIMELINE_TOKENS,
  transport: TRANSPORT_TOKENS,
  arrangement: ARRANGEMENT_TOKENS,
  'piano-roll': PIANO_ROLL_TOKENS,
  'vocal-editor': VOCAL_EDITOR_TOKENS,
  mixer: MIXER_TOKENS,
  meters: METERS_TOKENS,
  devices: DEVICES_TOKENS,
  browser: BROWSER_TOKENS,
  waveform: WAVEFORM_TOKENS,
  overlays: OVERLAYS_TOKENS,
  hardware: HARDWARE_TOKENS,
  notices: NOTICES_TOKENS,
};

/** Declared scope nesting (§5.4): inner set -> sets it may appear inside. */
export const SCOPE_NESTING: Readonly<Partial<Record<SetId, readonly SetId[]>>> = {
  meters: ['mixer', 'arrangement', 'transport'],
  devices: ['mixer'],
};

export * from './hardware';
