# @studio/audio-ui

Audio controls and meters for Studio, built on the headless primitives of
[`@audio-ui/react`](https://www.audio-ui.dev) (MIT, [ouestlabs/audio-ui](https://github.com/ouestlabs/audio-ui))
and styled with Studio's tokens.

```
src/
  components/   Studio's component set, composed from @audio-ui/react parts
  lib/          dB and taper maths, frame sources, meter frames with peak hold
```

## Studio component set

| Component                                                | Built on         | Use                                                                       |
| -------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------- |
| `VolumeFader`                                            | `Fader`          | Track and master volume in dB; takes a taper so travel matches the engine |
| `ParameterKnob`                                          | `Knob`           | Any continuous parameter; typed values via `parse`                        |
| `PanKnob`                                                | `Knob`           | Pan −1…1, centred, reads and types `L30` / `C` / `R30`                    |
| `StereoMeter`                                            | `Meter`          | L/R peak meter with hold and a clip latch, fed by a `FrameSource`         |
| `ParameterSliderField`                                   | `Fader`          | Labelled horizontal slider with value and hint, for inspectors            |
| `MuteToggle`, `SoloToggle`, `MonitorToggle`, `ArmToggle` | Base UI `Toggle` | Channel buttons (`@audio-ui/react` has none)                              |
| `EditableReadout`                                        | (own)            | Value readout you can double-click and type into                          |

Controls only report values (`onChange` while moving, `onCommit` at the end of a gesture).

- **Typed values** go through `EditableReadout` rather than the primitives' `Value editable`, because
  that one only parses plain numbers in the control's own units, and Studio's controls take text such
  as `L30`, `2.5 kHz` or `-inf`.
- **Faders** run the primitive in taper position space (0…1) and convert to dB, since `Fader` has no
  non-linear scale; `Knob` takes any range directly.
- **Meters** never re-render React. Give them a `FrameSource` and emit frames into it; the
  `@audio-ui/react` meter draws `peaks` but leaves hold timing to the caller, so use
  `createMeterEmitter()`, which adds peak hold and fall:

```ts
const source = createMeterEmitter();
renderLoop.add(() => source.emit(meterFrameFromGains(meter.peak)));
```

In `@studio/react`, `useEngineMeterSource` does this from `engine.readMeters()`.
