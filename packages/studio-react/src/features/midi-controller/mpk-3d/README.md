# MPK Mini MK3 — 3D view (experiment)

An experimental, read-only 3D view of the controller shown behind the "2D / 3D" toggle in
the MIDI controller panel. The model is built procedurally with three.js primitives from
`MPK_MINI_MK3_LAYOUT` (no model files, textures or brand marks) and mirrors live activity
from `session.midi.activity` every frame (keys, pads, knobs, buttons, joystick).

- `scene.ts` — pure model builder (`buildMpkScene`), no renderer; unit-tested in
  `packages/studio-react/tests/mpk-3d.test.ts`.
- `Mpk3DCanvas.tsx` — renderer, camera, OrbitControls, lights, render-on-demand loop,
  WebGL fallback, `prefers-reduced-motion` handling and full disposal on unmount.
- `Mpk3DView.tsx` — default export wired to the Studio session.
- `index.ts` — `LazyMpk3DView` (code-split, so three.js loads only when 3D is shown) and
  `MPK_3D_ENABLED`.

## Removing it

1. Delete this folder (`packages/studio-react/src/features/midi-controller/mpk-3d/`) and
   `packages/studio-react/tests/mpk-3d.test.ts`.
2. In `packages/studio-react/src/features/midi-controller/HardwareView.tsx`, remove the
   toggle block marked with `// mpk-3d experiment` comments (and its import).
3. Remove `three` and `@types/three` from `packages/studio-react/package.json`.
4. Run `pnpm install` to update the lockfile.
