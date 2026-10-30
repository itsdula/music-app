/**
 * Curated, stable `data-testid` anchors a tutorial step may spotlight. Every id here must exist
 * in Studio's source (enforced by a static-scan unit test), and the list is embedded in the
 * `create_tutorial` tool description so a model knows what it can point at.
 */
export interface TutorialAnchor {
  readonly id: string;
  /** What the element is, for a language model. */
  readonly description: string;
  /** Where it is visible (page / panel), so steps can use `before` to reveal it. */
  readonly where: string;
}

export const TUTORIAL_ANCHORS: readonly TutorialAnchor[] = [
  // Toolbar (always visible)
  { id: 'transport-bar', description: 'the top toolbar', where: 'always' },
  {
    id: 'project-menu',
    description: 'Studio menu: New project, demo, open recent, import/export bundles',
    where: 'toolbar',
  },
  { id: 'project-name', description: 'project name; double-click to rename', where: 'toolbar' },
  {
    id: 'view-switcher',
    description: 'page switcher: Projects / Arrange / Editor',
    where: 'toolbar',
  },
  { id: 'save-status', description: 'autosave status', where: 'toolbar' },
  { id: 'transport-play', description: 'Play/Pause button (Space)', where: 'toolbar' },
  { id: 'transport-stop', description: 'Stop button', where: 'toolbar' },
  {
    id: 'transport-record',
    description: 'Record button (R); records onto armed tracks',
    where: 'toolbar',
  },
  { id: 'transport-loop', description: 'Loop toggle (L)', where: 'toolbar' },
  {
    id: 'position-display',
    description: 'playhead position readout (bars.beats and time)',
    where: 'toolbar',
  },
  {
    id: 'open-export',
    description: 'Export audio button: opens the WAV export dialog',
    where: 'toolbar',
  },
  { id: 'open-settings', description: 'Settings button', where: 'toolbar' },
  { id: 'open-assistant', description: 'AI assistant toggle', where: 'toolbar' },
  { id: 'tutorial-menu', description: 'Tutorials menu', where: 'toolbar' },
  // Pages
  { id: 'projects-page', description: 'the Projects page (project list)', where: 'projects page' },
  { id: 'editor-view', description: 'the full-height clip editor page', where: 'editor page' },
  // Browser (left side of the arrange/editor pages)
  {
    id: 'browser-panel',
    description:
      'browser: instruments, audio effects and project files (double-click or drag to add)',
    where: 'arrange/editor page, left',
  },
  { id: 'import-audio', description: 'Import audio files button (WAV/MP3)', where: 'browser' },
  {
    id: 'midi-devices',
    description: 'MIDI devices section listing connected controllers',
    where: 'browser, bottom',
  },
  {
    id: 'midi-connect',
    description: 'Connect MIDI button (asks for MIDI access)',
    where: 'browser, MIDI devices section',
  },
  // Arrangement
  {
    id: 'arrangement',
    description: 'the arrangement (tracks and clips over time)',
    where: 'arrange page',
  },
  {
    id: 'add-track',
    description: '"+" Add track menu (instrument, drum, audio, vocal track)',
    where: 'arrange page, above track headers',
  },
  {
    id: 'add-instrument-track',
    description: 'menu item: Instrument track',
    where: 'Add track menu (open it first)',
  },
  {
    id: 'add-audio-track',
    description: 'menu item: Audio track',
    where: 'Add track menu (open it first)',
  },
  {
    id: 'add-vocal-track',
    description: 'menu item: Vocal track',
    where: 'Add track menu (open it first)',
  },
  {
    id: 'track-header',
    description:
      'a track header (name, mute, solo, arm); use "track-header:last" for the newest track',
    where: 'arrange page, left of the lanes',
  },
  { id: 'track-mute', description: 'track Mute button', where: 'track header' },
  { id: 'track-solo', description: 'track Solo button', where: 'track header' },
  { id: 'track-arm', description: 'track Arm-for-recording button', where: 'track header' },
  {
    id: 'track-monitor',
    description: 'input monitoring toggle (audio/vocal tracks)',
    where: 'track header',
  },
  {
    id: 'arrangement-ruler',
    description: 'timeline ruler: click to move the playhead, drag the top strip to set the loop',
    where: 'arrange page, above the lanes',
  },
  {
    id: 'arrangement-lanes',
    description:
      'track lanes: double-click empty space on an instrument track to create a MIDI clip; double-click a clip to open it',
    where: 'arrange page',
  },
  // Bottom panel / editors (tabs: role form "tab:Track", "tab:Piano Roll" (or "tab:Audio Clip"), "tab:Mixer", "tab:Controller")
  {
    id: 'piano-roll',
    description: 'the piano roll editor of the open MIDI clip',
    where: 'bottom panel "clip" with a MIDI clip open',
  },
  {
    id: 'piano-roll-grid',
    description: 'piano-roll note grid: double-click to draw a note, drag to move/resize',
    where: 'piano roll',
  },
  {
    id: 'track-devices',
    description: 'instrument and effect chain of the selected track',
    where: 'bottom panel "track"',
  },
  {
    id: 'instrument-panel',
    description: 'instrument controls of the selected track (right-click a control for MIDI Learn)',
    where: 'track devices',
  },
  { id: 'effect-chain', description: 'effect chain of the selected track', where: 'track devices' },
  {
    id: 'add-effect',
    description: 'Add effect menu (EQ, compressor, reverb, delay …)',
    where: 'track devices',
  },
  {
    id: 'effect-unit',
    description: 'an effect in the chain (on/off, reorder, remove, parameters)',
    where: 'track devices',
  },
  {
    id: 'audio-clip-editor',
    description: 'audio clip editor (gain, fades, trim)',
    where: 'bottom panel "clip" with an audio clip open in Clip mode',
  },
  { id: 'mixer', description: 'the mixer', where: 'bottom panel "mixer"' },
  {
    id: 'channel-strip',
    description: 'a track channel strip (volume fader, pan, mute/solo, meter)',
    where: 'mixer',
  },
  { id: 'master-strip', description: 'the master channel strip', where: 'mixer' },
  {
    id: 'controller-panel',
    description: 'MIDI controller panel (AKAI MPK Mini MK3): hardware, mappings, diagnostics',
    where: 'bottom panel "controller"',
  },
  {
    id: 'mpk-hardware-view',
    description: 'interactive picture of the controller; click a control to inspect it',
    where: 'controller panel, Hardware view',
  },
  {
    id: 'mappings-table',
    description: 'list of MIDI mappings',
    where: 'controller panel, Mappings view (radio:Mappings)',
  },
  {
    id: 'midi-diagnostics',
    description: 'live log of incoming MIDI messages',
    where: 'controller panel, Diagnostics view (radio:Diagnostics)',
  },
  // Vocal pitch editor (audio clip open, mode "radio:Pitch (vocal)", after "button:Analyze vocal")
  {
    id: 'vocal-editor',
    description: 'the vocal pitch editor',
    where: 'bottom panel "clip", audio clip in Pitch mode',
  },
  {
    id: 'vocal-pitch-editor',
    description: 'pitch canvas showing sung and corrected pitch',
    where: 'vocal editor (analyzed)',
  },
  { id: 'vocal-amount', description: 'Auto Tune amount slider', where: 'vocal editor (analyzed)' },
  { id: 'vocal-humanize', description: 'Humanize slider', where: 'vocal editor (analyzed)' },
  {
    id: 'vocal-key',
    description: 'key and scale for pitch snapping',
    where: 'vocal editor (analyzed)',
  },
  {
    id: 'vocal-edit-notes',
    description: 'Edit notes toggle: drag notes to retarget them',
    where: 'vocal editor (analyzed)',
  },
  {
    id: 'vocal-ab',
    description: 'A/B toggle: original vs corrected',
    where: 'vocal editor (analyzed)',
  },
  {
    id: 'vocal-notes-list-toggle',
    description: 'show the list of sung notes',
    where: 'vocal editor (analyzed)',
  },
  // Dialogs
  {
    id: 'export-dialog',
    description: 'export dialog body (range, sample rate, format)',
    where: 'export dialog (open-export first)',
  },
  {
    id: 'export-start',
    description: 'Export WAV button',
    where: 'export dialog (open-export first)',
  },
];

export const ANCHOR_IDS: ReadonlySet<string> = new Set(TUTORIAL_ANCHORS.map((a) => a.id));
