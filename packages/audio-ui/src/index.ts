/**
 * Audio controls and meters for Studio.
 *
 * Opinionated compositions sized and themed for the DAW (mixer strips, inspectors, transport),
 * built on the headless `@audio-ui/react` primitives (MIT, https://www.audio-ui.dev) and styled
 * with Studio's tokens. Controls only report values; meters read a live FrameSource, such as a
 * `createMeterEmitter()` driven from the engine's meter reads, and never re-render React.
 *
 * Styles: the host stylesheet scans this package for classes.
 */

export {
  ArmToggle,
  ChannelToggle,
  MonitorToggle,
  MuteToggle,
  SoloToggle,
} from './components/ChannelToggles';
export type { ChannelToggleProps, ChannelTogglePresetProps } from './components/ChannelToggles';
export { EditableReadout } from './components/EditableReadout';
export type { EditableReadoutProps } from './components/EditableReadout';
export { formatPan, PanKnob, ParameterKnob, parsePan } from './components/ParameterKnob';
export type { PanKnobProps, ParameterKnobProps } from './components/ParameterKnob';
export { ParameterSliderField } from './components/ParameterSliderField';
export type { ParameterSliderFieldProps } from './components/ParameterSliderField';
export { StereoMeter } from './components/StereoMeter';
export type { StereoMeterProps } from './components/StereoMeter';
export { VolumeFader } from './components/VolumeFader';
export type { VolumeFaderProps } from './components/VolumeFader';

export { dbToGain, formatDb, gainToDb, SILENCE_DB } from './lib/decibels';
export { createFrameEmitter } from './lib/frame-source';
export type { FrameEmitter, FrameSource } from './lib/frame-source';
export {
  createMeterEmitter,
  METER_FLOOR_DB,
  meterFrameFromGains,
  MIX_METER_CLIP_DB,
  MIX_METER_WARN_DB,
} from './lib/meter-frame';
export type { MeterEmitter, MeterEmitterOptions, MeterFrame } from './lib/meter-frame';
export { audioTaper, linearTaper, logTaper, resolveTaper } from './lib/taper';
export type { Taper, TaperInput } from './lib/taper';
