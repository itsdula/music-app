# @studio/audio-ui

Audio controls and meters for Studio, built on [audiocn](https://audiocn.dev) (MIT; vendored, see
[UPSTREAM.md](UPSTREAM.md)).

```
src/
  audiocn/      vendored audiocn primitives, kept identical to upstream (do not edit by hand)
  components/   Studio's component set, composed from the primitives
  lib/          helpers (engine meter frames, mix-bus meter zones)
  theme.css     shadcn/audiocn colour names mapped onto Studio tokens
```

## Studio component set

| Component                                                | Use                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `VolumeFader`                                            | Track and master volume in dB; takes a taper so travel matches the engine |
| `ParameterKnob`                                          | Any continuous parameter; typed values via `parse`                        |
| `PanKnob`                                                | Pan −1…1, centred, reads and types `L30` / `C` / `R30`                    |
| `StereoMeter`                                            | L/R peak meter with hold and a clip light, fed by a `FrameSource`         |
| `MuteToggle`, `SoloToggle`, `MonitorToggle`, `ArmToggle` | Channel buttons                                                           |
| `ParameterSliderField`                                   | Labelled slider with value and hint, for inspectors                       |

Controls only report values (`onChange` while moving, `onCommit` at the end of a gesture). Meters
never re-render React: give them a `FrameSource` and emit frames into it, for example

```ts
const source = createFrameEmitter<MeterFrame>();
renderLoop.add(() => source.emit(meterFrameFromGains(meter.peak, meter.rms)));
```

In `@studio/react`, `useEngineMeterSource` does this from `engine.readMeters()`.

The audiocn primitives (`Fader`, `Knob`, `LevelMeter`, `DbScale`, …) are exported too, for layouts
the set does not cover.
