/**
 * Device profiles describe a specific controller: how to recognise its ports, which
 * physical controls exist, what they send by default, and an optional layout model for
 * hardware-style views. Profiles live in their own packages (e.g.
 * @studio/midi-akai-mpk-mini-mk3) so generic MIDI code never contains device specifics.
 */
import type { MidiControlSource, MidiMapping } from '@studio/domain';
import type { MidiMessage } from './messages';
import type { MidiPortDescriptor } from './port';

export type DeviceControlKind =
  'key' | 'pad' | 'knob' | 'joystickX' | 'joystickY' | 'button' | 'pedal';

export interface DeviceControl {
  /** Stable id within the profile, e.g. 'pad.A1', 'knob.K3', 'key.12', 'joystick.x'. */
  readonly id: string;
  readonly kind: DeviceControlKind;
  /** Printed label on the hardware (or a descriptive name if unlabeled). */
  readonly label: string;
  /** What the control transmits in the profile's default (factory) program, if known. */
  readonly defaultSource?: MidiControlSource;
  /** Whether that default is documented, community-observed, or unverified. */
  readonly verification: VerificationStatus;
  /** Free-form note shown in the inspector (e.g. "handled internally by the device"). */
  readonly note?: string;
}

export type VerificationStatus = 'documented' | 'community' | 'unverified' | 'verified-hardware';

export interface DeviceControlEvent {
  readonly controlId: string;
  /** Normalized 0..1 value for continuous controls, 1/0 for press/release. */
  readonly value: number;
  readonly message: MidiMessage;
}

export interface LayoutRect {
  /** Normalized to the device top panel: x,y in 0..1 from top-left; w,h fractions. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface DeviceLayoutElement {
  readonly controlId: string;
  readonly rect: LayoutRect;
  readonly shape: 'key-white' | 'key-black' | 'pad' | 'knob' | 'joystick' | 'button' | 'display';
  readonly legend?: string;
  /** Secondary printed legend (e.g. shifted function). */
  readonly secondaryLegend?: string;
}

export interface DeviceLayout {
  /** Physical top-panel aspect ratio width / height. */
  readonly aspectRatio: number;
  readonly elements: readonly DeviceLayoutElement[];
  /** Source notes for how the layout was derived (citations live in docs). */
  readonly referenceNote: string;
}

export interface DeviceCapability {
  readonly id: string;
  readonly label: string;
  readonly support: 'supported' | 'software-equivalent' | 'unsupported' | 'experimental';
  readonly verification: VerificationStatus;
  readonly note: string;
}

export interface MidiDeviceProfile {
  readonly id: string;
  readonly displayName: string;
  readonly manufacturer: string;
  /** 0 = not this device; higher = better match. */
  matchPort(port: MidiPortDescriptor): number;
  readonly controls: readonly DeviceControl[];
  /** Identifies which physical control produced a message under default settings, if any. */
  identify(message: MidiMessage): DeviceControlEvent | null;
  /** Suggested default mappings (scope 'global'); ids are assigned by the caller. */
  defaultMappings(): ReadonlyArray<Omit<MidiMapping, 'id'>>;
  readonly capabilities: readonly DeviceCapability[];
  readonly layout?: DeviceLayout;
}
