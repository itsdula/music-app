/**
 * The tutorial format: declarative, data-only and safe to generate (the AI assistant creates
 * tutorials with it on the fly). No code, no selectors beyond a small allow-listed form, and a
 * closed set of conditions evaluated against session state. `validateTutorial` returns precise,
 * path-prefixed errors so a model can fix its own output.
 */
import type { BottomPanel, StudioView } from '../../state/ui-store';
import { ANCHOR_IDS } from './anchors';

// --- limits --------------------------------------------------------------------------------

export const TUTORIAL_LIMITS = {
  maxSteps: 20,
  idMaxLength: 48,
  titleMaxLength: 80,
  descriptionMaxLength: 240,
  bodyMaxLength: 400,
  roleNameMaxLength: 60,
  maxConditionDepth: 3,
  maxConditionChildren: 6,
  maxCount: 999,
} as const;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F]/;

// --- targets -------------------------------------------------------------------------------

/** Roles allowed in the `role:Accessible name` target form. */
export const TARGET_ROLES = [
  'button',
  'tab',
  'radio',
  'menuitem',
  'slider',
  'switch',
  'checkbox',
  'textbox',
] as const;
export type TargetRole = (typeof TARGET_ROLES)[number];

export type ParsedTarget =
  | { readonly kind: 'testid'; readonly id: string; readonly pick: 'first' | 'last' }
  | { readonly kind: 'role'; readonly role: TargetRole; readonly name: string };

const TESTID_TARGET = /^([a-z][a-z0-9-]{0,63})(?::(first|last))?$/;
const ROLE_TARGET = new RegExp(`^(${TARGET_ROLES.join('|')}):(.+)$`);

/**
 * Parses a step target. Two forms only:
 *  - `"<data-testid>"`, optionally `":first"`/`":last"` (default first visible match),
 *  - `"<role>:<accessible name>"`, e.g. `"tab:Mixer"` or `"button:Analyze vocal"`.
 */
export function parseTarget(target: string): ParsedTarget | null {
  const role = ROLE_TARGET.exec(target);
  if (role) {
    const name = role[2]!.trim();
    if (!name || name.length > TUTORIAL_LIMITS.roleNameMaxLength || CONTROL_CHARS.test(name))
      return null;
    return { kind: 'role', role: role[1] as TargetRole, name };
  }
  const testid = TESTID_TARGET.exec(target);
  if (testid)
    return { kind: 'testid', id: testid[1]!, pick: (testid[2] as 'first' | 'last') ?? 'first' };
  return null;
}

// --- conditions ----------------------------------------------------------------------------

export type TrackKindName = 'instrument' | 'audio' | 'vocal';
export type ClipKindName = 'midi' | 'audio';

/** A count rule: exactly one of `min` (absolute) or `added` (since the step started). */
export interface CountRule {
  readonly min?: number;
  readonly added?: number;
}

export type TutorialCondition =
  | { readonly type: 'view'; readonly view: StudioView }
  | { readonly type: 'panelOpen'; readonly panel: BottomPanel }
  | { readonly type: 'assistantOpen' }
  | ({ readonly type: 'trackCount'; readonly kind?: TrackKindName } & CountRule)
  | { readonly type: 'trackExists'; readonly kind: TrackKindName }
  | { readonly type: 'trackArmed' }
  | { readonly type: 'trackSelected' }
  | ({ readonly type: 'clipCount'; readonly kind?: ClipKindName } & CountRule)
  | { readonly type: 'midiClipOpen' }
  | { readonly type: 'audioClipOpen' }
  | { readonly type: 'noClipOpen' }
  | { readonly type: 'pitchEditorOpen' }
  | ({ readonly type: 'noteCount' } & CountRule)
  | { readonly type: 'playing' }
  | { readonly type: 'stopped' }
  | { readonly type: 'recording' }
  | { readonly type: 'loopEnabled'; readonly value?: boolean }
  | { readonly type: 'metronomeEnabled'; readonly value?: boolean }
  | { readonly type: 'tempoChanged' }
  | ({ readonly type: 'effectCount' } & CountRule)
  | { readonly type: 'projectRenamed' }
  | { readonly type: 'projectChanged' }
  | { readonly type: 'midiConnected' }
  | ({ readonly type: 'midiMappingCount' } & CountRule)
  | { readonly type: 'vocalAnalyzed' }
  | { readonly type: 'all'; readonly conditions: readonly TutorialCondition[] }
  | { readonly type: 'any'; readonly conditions: readonly TutorialCondition[] };

export type ConditionType = TutorialCondition['type'];

type FieldKind =
  | 'view'
  | 'panel'
  | 'trackKind'
  | 'clipKind'
  | 'boolean'
  | 'count'
  | 'conditions'
  | 'requiredTrackKind';

interface ConditionSpec {
  readonly doc: string;
  readonly fields: Readonly<Record<string, FieldKind>>;
  /** Count conditions take exactly one of `min` / `added`. */
  readonly counted?: boolean;
}

export const STUDIO_VIEW_NAMES: readonly StudioView[] = ['projects', 'arrange', 'editor'];
export const BOTTOM_PANEL_NAMES: readonly BottomPanel[] = ['track', 'clip', 'mixer', 'controller'];
const TRACK_KINDS: readonly TrackKindName[] = ['instrument', 'audio', 'vocal'];
const CLIP_KINDS: readonly ClipKindName[] = ['midi', 'audio'];
const COUNT_FIELDS = { min: 'count', added: 'count' } as const;

/** The closed set of conditions, with docs used in the AI tool description. */
export const CONDITION_SPECS: Readonly<Record<ConditionType, ConditionSpec>> = {
  view: {
    doc: 'the current page is `view` (projects | arrange | editor)',
    fields: { view: 'view' },
  },
  panelOpen: {
    doc: 'the bottom panel shows `panel` (editor | mixer | controller)',
    fields: { panel: 'panel' },
  },
  assistantOpen: { doc: 'the AI assistant panel is open', fields: {} },
  trackCount: {
    doc: 'number of tracks (optionally of `kind` instrument | audio | vocal)',
    fields: { kind: 'trackKind', ...COUNT_FIELDS },
    counted: true,
  },
  trackExists: {
    doc: 'a track of `kind` (instrument | audio | vocal) exists',
    fields: { kind: 'requiredTrackKind' },
  },
  trackArmed: { doc: 'some track is armed for recording', fields: {} },
  trackSelected: { doc: 'a track is selected', fields: {} },
  clipCount: {
    doc: 'number of clips (optionally of `kind` midi | audio)',
    fields: { kind: 'clipKind', ...COUNT_FIELDS },
    counted: true,
  },
  midiClipOpen: { doc: 'a MIDI clip is open in the piano roll', fields: {} },
  audioClipOpen: { doc: 'an audio clip is open in the clip editor', fields: {} },
  noClipOpen: { doc: 'no clip is open (the Piano Roll / clip tab is disabled)', fields: {} },
  pitchEditorOpen: { doc: 'an audio clip is open in the vocal pitch editor', fields: {} },
  noteCount: { doc: 'notes in the open MIDI clip', fields: COUNT_FIELDS, counted: true },
  playing: { doc: 'the transport is playing', fields: {} },
  stopped: { doc: 'the transport is stopped', fields: {} },
  recording: { doc: 'recording is in progress', fields: {} },
  loopEnabled: { doc: 'loop is on (or off with `value: false`)', fields: { value: 'boolean' } },
  metronomeEnabled: {
    doc: 'metronome is on (or off with `value: false`)',
    fields: { value: 'boolean' },
  },
  tempoChanged: { doc: 'the tempo changed since the step started', fields: {} },
  effectCount: {
    doc: 'number of effects on all tracks and the master',
    fields: COUNT_FIELDS,
    counted: true,
  },
  projectRenamed: { doc: 'the project was renamed since the step started', fields: {} },
  projectChanged: {
    doc: 'a different project was created or opened since the step started',
    fields: {},
  },
  midiConnected: { doc: 'MIDI access is granted (Connect MIDI was used)', fields: {} },
  midiMappingCount: {
    doc: 'number of MIDI mappings (project + global)',
    fields: COUNT_FIELDS,
    counted: true,
  },
  vocalAnalyzed: { doc: 'the open audio clip has been analyzed by the pitch editor', fields: {} },
  all: { doc: 'every condition in `conditions` holds', fields: { conditions: 'conditions' } },
  any: {
    doc: 'at least one condition in `conditions` holds',
    fields: { conditions: 'conditions' },
  },
};

export const CONDITION_TYPES = Object.keys(CONDITION_SPECS) as ConditionType[];

// --- tutorial ------------------------------------------------------------------------------

export type Placement = 'auto' | 'top' | 'bottom' | 'left' | 'right' | 'center';
export const PLACEMENTS: readonly Placement[] = [
  'auto',
  'top',
  'bottom',
  'left',
  'right',
  'center',
];

export type TutorialAdvance =
  | { readonly type: 'next' }
  | { readonly type: 'click'; readonly target?: string }
  | { readonly type: 'tool'; readonly name: string }
  | { readonly type: 'condition'; readonly condition: TutorialCondition };

export interface TutorialStepBefore {
  readonly navigate?: StudioView;
  readonly openPanel?: BottomPanel;
}

export interface TutorialStep {
  readonly id: string;
  readonly title: string;
  /** Short plain text (no markup). */
  readonly body: string;
  /** Element to spotlight; see `parseTarget`. Omit for a centered card. */
  readonly target?: string;
  readonly placement?: Placement;
  /** Applied when the step starts (navigate first, then open the bottom panel). */
  readonly before?: TutorialStepBefore;
  readonly advance: TutorialAdvance;
}

export interface Tutorial {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly TutorialStep[];
}

// --- validation ----------------------------------------------------------------------------

export type ValidationResult =
  | { readonly ok: true; readonly tutorial: Tutorial }
  | { readonly ok: false; readonly errors: readonly string[] };

export interface ValidateOptions {
  /** Tool names a `{type:'tool'}` advance may wait for (unchecked when omitted). */
  readonly knownTools?: readonly string[];
  /** Ids that may not be used (e.g. built-in tutorials). */
  readonly reservedIds?: readonly string[];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (values: readonly string[]) => values.join(' | ');

class Collector {
  readonly errors: string[] = [];
  add(path: string, message: string): void {
    if (this.errors.length < 50) this.errors.push(`${path} ${message}`);
  }
  /** Reports keys not in `allowed`. */
  keys(path: string, obj: Obj, allowed: readonly string[]): void {
    for (const key of Object.keys(obj))
      if (!allowed.includes(key))
        this.add(`${path}.${key}`, `is not allowed (allowed keys: ${allowed.join(', ')})`);
  }
  text(path: string, value: unknown, max: number, required = true): string | undefined {
    if (value === undefined) {
      if (required) this.add(path, 'is required');
      return undefined;
    }
    if (typeof value !== 'string') {
      this.add(path, 'must be a string');
      return undefined;
    }
    if (!value.trim()) this.add(path, 'must not be empty');
    else if (value.length > max)
      this.add(path, `must be at most ${max} characters (got ${value.length})`);
    else if (CONTROL_CHARS.test(value))
      this.add(path, 'must be plain text without control characters');
    return value;
  }
  id(path: string, value: unknown): string | undefined {
    if (typeof value !== 'string') {
      this.add(path, value === undefined ? 'is required' : 'must be a string');
      return undefined;
    }
    if (value.length > TUTORIAL_LIMITS.idMaxLength || !ID_PATTERN.test(value))
      this.add(
        path,
        `must be lowercase letters, digits and dashes (max ${TUTORIAL_LIMITS.idMaxLength}), e.g. "add-reverb"; got ${JSON.stringify(value)}`,
      );
    return value;
  }
  oneOf<T extends string>(path: string, value: unknown, options: readonly T[]): T | undefined {
    if (typeof value !== 'string' || !options.includes(value as T)) {
      this.add(
        path,
        value === undefined
          ? `is required (one of ${list(options)})`
          : `must be one of ${list(options)}; got ${JSON.stringify(value)}`,
      );
      return undefined;
    }
    return value as T;
  }
  target(path: string, value: unknown): void {
    if (typeof value !== 'string') {
      this.add(path, 'must be a string');
      return;
    }
    const parsed = parseTarget(value);
    if (!parsed) {
      this.add(
        path,
        `${JSON.stringify(value)} is not a valid target: use an anchor id (e.g. "transport-play", optionally "track-header:last") or "<role>:<accessible name>" with role ${list(TARGET_ROLES)} (e.g. "tab:Mixer")`,
      );
      return;
    }
    if (parsed.kind === 'testid' && !ANCHOR_IDS.has(parsed.id))
      this.add(
        path,
        `"${parsed.id}" is not a known anchor; use one of the anchor ids listed in the tool description or a role form like "button:Analyze vocal"`,
      );
  }
}

function validateCondition(c: Collector, path: string, value: unknown, depth: number): void {
  if (!isObj(value)) {
    c.add(path, 'must be an object like {"type": "playing"}');
    return;
  }
  const type = c.oneOf(`${path}.type`, value.type, CONDITION_TYPES);
  if (!type) return;
  const spec = CONDITION_SPECS[type];
  c.keys(path, value, ['type', ...Object.keys(spec.fields)]);
  for (const [field, kind] of Object.entries(spec.fields)) {
    const v = value[field];
    const p = `${path}.${field}`;
    switch (kind) {
      case 'view':
        c.oneOf(p, v, STUDIO_VIEW_NAMES);
        break;
      case 'panel':
        c.oneOf(p, v, BOTTOM_PANEL_NAMES);
        break;
      case 'requiredTrackKind':
        c.oneOf(p, v, TRACK_KINDS);
        break;
      case 'trackKind':
        if (v !== undefined) c.oneOf(p, v, TRACK_KINDS);
        break;
      case 'clipKind':
        if (v !== undefined) c.oneOf(p, v, CLIP_KINDS);
        break;
      case 'boolean':
        if (v !== undefined && typeof v !== 'boolean') c.add(p, 'must be true or false');
        break;
      case 'count':
        if (
          v !== undefined &&
          (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > TUTORIAL_LIMITS.maxCount)
        )
          c.add(p, `must be an integer from 0 to ${TUTORIAL_LIMITS.maxCount}`);
        break;
      case 'conditions': {
        if (!Array.isArray(v) || v.length === 0) {
          c.add(p, 'must be a non-empty array of conditions');
          break;
        }
        if (v.length > TUTORIAL_LIMITS.maxConditionChildren)
          c.add(p, `allows at most ${TUTORIAL_LIMITS.maxConditionChildren} conditions`);
        if (depth >= TUTORIAL_LIMITS.maxConditionDepth) {
          c.add(p, `nests too deeply (max depth ${TUTORIAL_LIMITS.maxConditionDepth})`);
          break;
        }
        v.forEach((child, i) => validateCondition(c, `${p}[${i}]`, child, depth + 1));
        break;
      }
    }
  }
  if (spec.counted) {
    const hasMin = value.min !== undefined;
    const hasAdded = value.added !== undefined;
    if (hasMin === hasAdded)
      c.add(
        path,
        `(type "${type}") needs exactly one of "min" (absolute) or "added" (since the step started)`,
      );
  }
}

function validateStep(c: Collector, path: string, value: unknown, options: ValidateOptions): void {
  if (!isObj(value)) {
    c.add(path, 'must be an object');
    return;
  }
  c.keys(path, value, ['id', 'title', 'body', 'target', 'placement', 'before', 'advance']);
  c.id(`${path}.id`, value.id);
  c.text(`${path}.title`, value.title, TUTORIAL_LIMITS.titleMaxLength);
  c.text(`${path}.body`, value.body, TUTORIAL_LIMITS.bodyMaxLength);
  if (value.target !== undefined) c.target(`${path}.target`, value.target);
  if (value.placement !== undefined) c.oneOf(`${path}.placement`, value.placement, PLACEMENTS);
  if (value.before !== undefined) {
    if (!isObj(value.before)) c.add(`${path}.before`, 'must be an object');
    else {
      c.keys(`${path}.before`, value.before, ['navigate', 'openPanel']);
      if (value.before.navigate !== undefined)
        c.oneOf(`${path}.before.navigate`, value.before.navigate, STUDIO_VIEW_NAMES);
      if (value.before.openPanel !== undefined)
        c.oneOf(`${path}.before.openPanel`, value.before.openPanel, BOTTOM_PANEL_NAMES);
    }
  }
  const advance = value.advance;
  const ap = `${path}.advance`;
  if (!isObj(advance)) {
    c.add(ap, advance === undefined ? 'is required' : 'must be an object like {"type": "next"}');
    return;
  }
  const type = c.oneOf(`${ap}.type`, advance.type, ['next', 'click', 'tool', 'condition'] as const);
  switch (type) {
    case 'next':
      c.keys(ap, advance, ['type']);
      break;
    case 'click':
      c.keys(ap, advance, ['type', 'target']);
      if (advance.target !== undefined) c.target(`${ap}.target`, advance.target);
      else if (value.target === undefined)
        c.add(ap, '(type "click") needs a target on the step or on the advance');
      break;
    case 'tool': {
      c.keys(ap, advance, ['type', 'name']);
      const name = advance.name;
      if (typeof name !== 'string' || !TOOL_NAME.test(name))
        c.add(`${ap}.name`, 'must be a tool name matching ^[a-z][a-z0-9_]{0,63}$');
      else if (options.knownTools && !options.knownTools.includes(name))
        c.add(`${ap}.name`, `"${name}" is not an available tool`);
      break;
    }
    case 'condition':
      c.keys(ap, advance, ['type', 'condition']);
      validateCondition(c, `${ap}.condition`, advance.condition, 1);
      break;
    case undefined:
      break;
  }
}

/** Validates untrusted input (e.g. from a model) and returns a typed tutorial or errors. */
export function validateTutorial(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const c = new Collector();
  if (!isObj(input)) return { ok: false, errors: ['tutorial must be an object'] };
  c.keys('tutorial', input, ['id', 'title', 'description', 'steps']);
  const id = c.id('tutorial.id', input.id);
  if (id && options.reservedIds?.includes(id))
    c.add('tutorial.id', `"${id}" is reserved by a built-in tutorial; choose another id`);
  c.text('tutorial.title', input.title, TUTORIAL_LIMITS.titleMaxLength);
  c.text('tutorial.description', input.description, TUTORIAL_LIMITS.descriptionMaxLength);
  const steps = input.steps;
  if (!Array.isArray(steps)) {
    c.add('tutorial.steps', steps === undefined ? 'is required' : 'must be an array');
  } else if (steps.length === 0) {
    c.add('tutorial.steps', 'needs at least one step');
  } else {
    if (steps.length > TUTORIAL_LIMITS.maxSteps)
      c.add(
        'tutorial.steps',
        `allows at most ${TUTORIAL_LIMITS.maxSteps} steps (got ${steps.length})`,
      );
    const seen = new Set<string>();
    steps.slice(0, TUTORIAL_LIMITS.maxSteps).forEach((step, i) => {
      validateStep(c, `tutorial.steps[${i}]`, step, options);
      if (isObj(step) && typeof step.id === 'string') {
        if (seen.has(step.id))
          c.add(`tutorial.steps[${i}].id`, `"${step.id}" is used by an earlier step`);
        seen.add(step.id);
      }
    });
  }
  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  // Deep copy: the caller's object can't change the running tutorial afterwards.
  return { ok: true, tutorial: JSON.parse(JSON.stringify(input)) as Tutorial };
}
