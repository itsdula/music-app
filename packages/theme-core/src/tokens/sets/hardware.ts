/**
 * MPK Mini hardware view (inline SVG). It depicts a physical device, so every token here is
 * mode-independent: light/dark never changes it. Instead the look is chosen from colorway
 * presets matching AKAI Professional's MPK Mini MK3 editions (akaipro.com/mpk-mini-mk3 and
 * retailer listings: standard black, Black on Black, White, Grey and Red).
 */
import { lit, type TokenDef } from '../registry';
import { setColor } from './helpers';

export const HARDWARE_TOKEN_NAMES = [
  'hardware-body-top',
  'hardware-body-bottom',
  'hardware-edge',
  'hardware-panel',
  'hardware-label',
  'hardware-screen',
  'hardware-screen-border',
  'hardware-screen-text',
  'hardware-slot',
  'hardware-slot-border',
  'hardware-knob-top',
  'hardware-knob-bottom',
  'hardware-knob-stroke',
  'hardware-knob-pointer',
  'hardware-knob-value',
  'hardware-pad',
  'hardware-pad-border',
  'hardware-pad-label',
  'hardware-pad-a',
  'hardware-pad-b',
  'hardware-button',
  'hardware-button-border',
  'hardware-button-label',
  'hardware-button-active',
  'hardware-key-white',
  'hardware-key-white-border',
  'hardware-key-label',
  'hardware-key-black',
  'hardware-active',
] as const;
export type HardwareTokenName = (typeof HARDWARE_TOKEN_NAMES)[number];

export type HardwareColorwayId = 'standard' | 'black-on-black' | 'white' | 'grey' | 'red';

export interface HardwareColorway {
  readonly id: HardwareColorwayId;
  readonly name: string;
  readonly description: string;
  readonly tokens: Readonly<Record<HardwareTokenName, string>>;
}

const STANDARD: Record<HardwareTokenName, string> = {
  'hardware-body-top': '#23262d',
  'hardware-body-bottom': '#15171b',
  'hardware-edge': '#33363f',
  'hardware-panel': '#0f1013',
  'hardware-label': '#8f95a1',
  'hardware-screen': '#05070a',
  'hardware-screen-border': '#2a2d34',
  'hardware-screen-text': '#d7e7ff',
  'hardware-slot': '#0d0e11',
  'hardware-slot-border': '#30333b',
  'hardware-knob-top': '#3a3e47',
  'hardware-knob-bottom': '#1b1d22',
  'hardware-knob-stroke': '#4a4e58',
  'hardware-knob-pointer': '#f2f3f5',
  'hardware-knob-value': '#c9cdd5',
  'hardware-pad': '#24262c',
  'hardware-pad-border': '#3a3d45',
  'hardware-pad-label': '#8f95a1',
  'hardware-pad-a': '#f16d75',
  'hardware-pad-b': '#3cc8b4',
  'hardware-button': '#2b2e35',
  'hardware-button-border': '#41444d',
  'hardware-button-label': '#9aa0ab',
  'hardware-button-active': '#e9eaee',
  'hardware-key-white': '#e7e8ec',
  'hardware-key-white-border': '#9ca0a9',
  'hardware-key-label': '#5d626d',
  'hardware-key-black': '#17191d',
  'hardware-active': '#8b7cf6',
};

const BLACK_KEYS = {
  'hardware-key-white': '#25272c',
  'hardware-key-white-border': '#0b0c0e',
  'hardware-key-label': '#8f95a1',
  'hardware-key-black': '#0b0c0e',
} as const;

export const HARDWARE_COLORWAYS: Readonly<Record<HardwareColorwayId, HardwareColorway>> = {
  standard: {
    id: 'standard',
    name: 'Standard',
    description: 'Black body, white and black keys (the original MPK Mini MK3).',
    tokens: STANDARD,
  },
  'black-on-black': {
    id: 'black-on-black',
    name: 'Black on Black',
    description: 'Limited edition: black body with black keys.',
    tokens: {
      ...STANDARD,
      'hardware-body-top': '#191b1f',
      'hardware-body-bottom': '#0c0d10',
      'hardware-edge': '#26282e',
      'hardware-panel': '#08090b',
      'hardware-pad': '#1a1c20',
      'hardware-pad-border': '#2c2f35',
      'hardware-button': '#1e2025',
      'hardware-button-border': '#33363d',
      ...BLACK_KEYS,
    },
  },
  white: {
    id: 'white',
    name: 'White',
    description: 'Limited edition: white body with black knobs.',
    tokens: {
      ...STANDARD,
      'hardware-body-top': '#f1f2f4',
      'hardware-body-bottom': '#d8dbe0',
      'hardware-edge': '#c3c7ce',
      'hardware-panel': '#e6e8ec',
      'hardware-label': '#5d626d',
      'hardware-slot': '#cdd0d6',
      'hardware-slot-border': '#b2b6be',
      'hardware-pad': '#d2d5db',
      'hardware-pad-border': '#b4b8c0',
      'hardware-pad-label': '#4a4f5a',
      'hardware-button': '#dde0e5',
      'hardware-button-border': '#b6bac2',
      'hardware-button-label': '#4a4f5a',
      'hardware-button-active': '#2b2e35',
    },
  },
  grey: {
    id: 'grey',
    name: 'Grey',
    description: 'Special edition: grey body.',
    tokens: {
      ...STANDARD,
      'hardware-body-top': '#6e727b',
      'hardware-body-bottom': '#565961',
      'hardware-edge': '#80848d',
      'hardware-panel': '#45484f',
      'hardware-label': '#d3d6dc',
      'hardware-pad': '#3a3d44',
      'hardware-pad-border': '#50535b',
      'hardware-pad-label': '#c9cdd5',
      'hardware-button': '#4b4e56',
      'hardware-button-border': '#62656d',
      'hardware-button-label': '#d3d6dc',
    },
  },
  red: {
    id: 'red',
    name: 'Red',
    description: 'Special edition: red body with black keys.',
    tokens: {
      ...STANDARD,
      'hardware-body-top': '#c9343c',
      'hardware-body-bottom': '#a2252d',
      'hardware-edge': '#d84a52',
      'hardware-panel': '#7f1a21',
      'hardware-label': '#f6d3d5',
      'hardware-pad': '#2b2e35',
      'hardware-pad-border': '#41444d',
      'hardware-pad-label': '#c9cdd5',
      'hardware-button': '#8e1f26',
      'hardware-button-border': '#b0333b',
      'hardware-button-label': '#f6d3d5',
      'hardware-pad-a': '#ffffff',
      ...BLACK_KEYS,
    },
  },
};

export const DEFAULT_HARDWARE_COLORWAY: HardwareColorwayId = 'standard';

const c = setColor('hardware', { utility: true });

export const HARDWARE_TOKENS: readonly TokenDef[] = HARDWARE_TOKEN_NAMES.map((name) =>
  c(name, lit(STANDARD[name]), { invariant: true }),
);
