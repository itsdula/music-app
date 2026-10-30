/**
 * Audio controls and meters for Studio.
 *
 * `components/` is Studio's component set: opinionated compositions sized and themed for the
 * DAW (mixer strips, inspectors, transport). They are built from the audiocn primitives in
 * `audiocn/` (vendored, MIT; see UPSTREAM.md), which are re-exported below for custom
 * layouts. Controls only report values; feed meters with a FrameSource such as
 * `createFrameEmitter()` driven from the engine's meter reads.
 *
 * Styles: the host stylesheet imports `@studio/audio-ui/theme.css` and scans this package.
 */

// Studio component set
export {
  ArmToggle,
  ChannelToggle,
  MonitorToggle,
  MuteToggle,
  SoloToggle,
} from './components/ChannelToggles';
export type { ChannelTogglePresetProps } from './components/ChannelToggles';
export { PanKnob, ParameterKnob } from './components/ParameterKnob';
export type { PanKnobProps, ParameterKnobProps } from './components/ParameterKnob';
export { ParameterSliderField } from './components/ParameterSliderField';
export type { ParameterSliderFieldProps } from './components/ParameterSliderField';
export { StereoMeter } from './components/StereoMeter';
export type { StereoMeterProps } from './components/StereoMeter';
export { VolumeFader } from './components/VolumeFader';
export type { VolumeFaderProps } from './components/VolumeFader';
export { MIX_METER_ZONES, meterFrameFromGains } from './lib/meter-frame';

// audiocn primitives
export * from './audiocn/components/ui/clip-indicator';
export * from './audiocn/components/ui/db-readout';
export * from './audiocn/components/ui/db-scale';
export * from './audiocn/components/ui/fader';
export * from './audiocn/components/ui/knob';
export * from './audiocn/components/ui/level-meter';
export * from './audiocn/components/ui/pan-control';
export * from './audiocn/components/ui/parameter-slider';
export { AudioConfigProvider, useAudioConfig } from './audiocn/hooks/use-audio-config';
export type { AudioConfig, AudioSize } from './audiocn/hooks/use-audio-config';
export { useFrameSource } from './audiocn/hooks/use-frame-source';
export { createFrameEmitter, createFrameRelay } from './audiocn/lib/audio/frame-source';
export type { FrameEmitter, FrameRelay } from './audiocn/lib/audio/frame-source';
export { dbToGain, formatDb, gainToDb, SILENCE_DB } from './audiocn/lib/audio/decibels';
export { audioTaper, linearTaper, logTaper } from './audiocn/lib/audio/taper';
export type { TaperInput } from './audiocn/lib/audio/taper';
export type {
  ChannelLevel,
  FrameSource,
  MeterFrame,
  MeterZone,
  Orientation,
  Taper,
} from './audiocn/lib/audio/types';
