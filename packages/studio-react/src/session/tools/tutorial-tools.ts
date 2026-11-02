/**
 * Tutorial tools: list and start built-in tours, and the Tutorial Creator (`create_tutorial`),
 * which lets the assistant build a guided tour on the fly from a declarative definition.
 */
import type { JsonSchema } from '@studio/platform-contracts';
import { TUTORIAL_ANCHORS } from '../../features/tutorial/anchors';
import { TutorialController } from '../../features/tutorial/controller';
import {
  BOTTOM_PANEL_NAMES,
  CONDITION_SPECS,
  CONDITION_TYPES,
  PLACEMENTS,
  STUDIO_VIEW_NAMES,
  TARGET_ROLES,
  TUTORIAL_LIMITS,
  validateTutorial,
} from '../../features/tutorial/schema';
import type { StudioSession } from '../studio-session';
import type { StudioTool, ToolRegistry } from './registry';

const L = TUTORIAL_LIMITS;

/** The anchor list, one line each, for the create_tutorial description. */
export function describeAnchors(): string {
  return TUTORIAL_ANCHORS.map((a) => `- ${a.id}: ${a.description} [${a.where}]`).join('\n');
}

export function describeConditions(): string {
  return CONDITION_TYPES.map((type) => {
    const spec = CONDITION_SPECS[type];
    const fields = Object.keys(spec.fields);
    return `- ${type}${fields.length ? ` {${fields.join(', ')}}` : ''}: ${spec.doc}`;
  }).join('\n');
}

const CREATE_DESCRIPTION = `Create and immediately start a guided, interactive tutorial in Nawa that walks the user through a task step by step: each step spotlights a real control, explains it in a short card, and advances when the user actually does it.
Use this when the user asks how to do something in Nawa ("how do I add reverb?", "teach me to record"). Prefer start_tutorial when a built-in tour (see list_tutorials) already covers the task.
If the result has ok:false, fix every listed error and call again.

Format: {id, title, description, steps[]} with at most ${L.maxSteps} steps; ids are lowercase-with-dashes; title ≤ ${L.titleMaxLength} chars; description ≤ ${L.descriptionMaxLength}; body ≤ ${L.bodyMaxLength} chars of plain text (no markup).
Step: {id, title, body, target?, placement?, before?, advance}
- target: an anchor id from the list below (append ":last" to pick the last match, e.g. "track-header:last"), or "<role>:<accessible name>" with role ${TARGET_ROLES.join(' | ')} for controls without an anchor, e.g. "tab:Mixer", "tab:Controller", "tab:Track", "radio:Pitch (vocal)", "button:Analyze vocal", "menuitem:New project". Omit target for an explanatory card in the middle of the screen. If a target isn't on screen, the card falls back to the center.
- placement: ${PLACEMENTS.join(' | ')} (card position relative to the target; default auto).
- before: {navigate?: ${STUDIO_VIEW_NAMES.join(' | ')}, openPanel?: ${BOTTOM_PANEL_NAMES.join(' | ')}} applied when the step starts, to reveal the target.
- advance (when the step is done):
  {"type":"next"} — the user presses Next (use for explanations);
  {"type":"click","target"?} — the user clicks the step target (or the given target);
  {"type":"tool","name"} — a Nawa tool with that name is called successfully;
  {"type":"condition","condition"} — Nawa state matches (preferred for actions). If a condition already holds when the step starts, the step is skipped.
Conditions (count conditions take exactly one of "min" = absolute count or "added" = increase since the step started):
${describeConditions()}

Anchors (data-testid values) and where they are visible:
${describeAnchors()}

Tips: one action per step; reveal hidden UI with "before" or an earlier step (menus must be opened before their items are visible; the bottom panel's "track" tab shows the selected track's devices, its "clip" tab shows the piano roll or audio editor of the selected clip and is disabled while none is selected); a typical tour has 3–8 steps and ends with a short "next" step summarising what was learned.
Example: {"id":"add-reverb","title":"Add reverb","description":"Put reverb on a track.","steps":[{"id":"select","title":"Show the devices","body":"Click the \\"Track\\" tab to see the selected track's instrument and effects.","target":"tab:Track","advance":{"type":"condition","condition":{"type":"panelOpen","panel":"track"}}},{"id":"add","title":"Add Reverb","body":"Click Add effect and choose Reverb.","target":"add-effect","advance":{"type":"condition","condition":{"type":"effectCount","added":1}}},{"id":"done","title":"Done","body":"Turn Mix up for a bigger room.","target":"effect-chain","advance":{"type":"next"}}]}`;

const conditionSchema: JsonSchema = {
  type: 'object',
  description: 'A state condition; see the tool description for types and fields.',
  properties: {
    type: { type: 'string', enum: CONDITION_TYPES },
    view: { type: 'string', enum: STUDIO_VIEW_NAMES },
    panel: { type: 'string', enum: BOTTOM_PANEL_NAMES },
    kind: { type: 'string', enum: ['instrument', 'audio', 'vocal', 'midi'] },
    min: { type: 'integer', minimum: 0, maximum: L.maxCount },
    added: { type: 'integer', minimum: 0, maximum: L.maxCount },
    value: { type: 'boolean' },
    conditions: {
      type: 'array',
      description: 'For "all" / "any": nested conditions.',
      items: { type: 'object' },
    },
  },
  required: ['type'],
};

const tutorialSchema: JsonSchema = {
  type: 'object',
  description: 'The tutorial definition.',
  properties: {
    id: { type: 'string', description: 'lowercase-with-dashes, e.g. "add-reverb"' },
    title: { type: 'string' },
    description: { type: 'string' },
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: L.maxSteps,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string', description: 'Short plain-text instruction.' },
          target: { type: 'string', description: 'Anchor id or "<role>:<name>".' },
          placement: { type: 'string', enum: PLACEMENTS },
          before: {
            type: 'object',
            properties: {
              navigate: { type: 'string', enum: STUDIO_VIEW_NAMES },
              openPanel: { type: 'string', enum: BOTTOM_PANEL_NAMES },
            },
          },
          advance: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['next', 'click', 'tool', 'condition'] },
              target: { type: 'string' },
              name: { type: 'string' },
              condition: conditionSchema,
            },
            required: ['type'],
          },
        },
        required: ['id', 'title', 'body', 'advance'],
      },
    },
  },
  required: ['id', 'title', 'description', 'steps'],
};

export function registerTutorialTools(registry: ToolRegistry, session: StudioSession): () => void {
  const controller = TutorialController.forSession(session);

  const activeSummary = () => {
    const active = controller.store.getState().active;
    if (!active) return null;
    const step = active.tutorial.steps[active.stepIndex];
    return {
      id: active.tutorial.id,
      title: active.tutorial.title,
      step: active.stepIndex + 1,
      of: active.tutorial.steps.length,
      stepTitle: step?.title ?? '',
    };
  };

  const tools: StudioTool<never>[] = [
    {
      name: 'list_tutorials',
      title: 'List tutorials',
      description:
        'Lists the guided tutorials available in Nawa (built-in tours and ones created with create_tutorial), whether the user completed them, and the tutorial that is currently running, if any.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      readOnly: true,
      run: () => ({ tutorials: controller.list(), active: activeSummary() }),
    } satisfies StudioTool<Record<string, never>>,
    {
      name: 'start_tutorial',
      title: 'Start tutorial',
      description:
        'Starts a guided tutorial by id (see list_tutorials), replacing any running one. Built-in: "getting-started" (first song end to end), "midi-controller" (connect and map a MIDI keyboard), "vocal-pitch" (vocal pitch editor and Auto Tune), "recording-audio" (record from a microphone).',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Tutorial id.' } },
        required: ['id'],
        additionalProperties: false,
      },
      run: (input: { id: string }) => {
        if (!controller.start(input.id)) {
          const ids = controller.list().map((t) => t.id);
          throw new Error(`Unknown tutorial "${input.id}". Available: ${ids.join(', ')}`);
        }
        return { started: input.id, active: activeSummary() };
      },
    } satisfies StudioTool<{ id: string }>,
    {
      name: 'create_tutorial',
      title: 'Create tutorial',
      description: CREATE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: { tutorial: tutorialSchema },
        required: ['tutorial'],
        additionalProperties: false,
      },
      run: (input: { tutorial: unknown }) => {
        const result = validateTutorial(input.tutorial, {
          knownTools: registry.list().map((t) => t.name),
          reservedIds: controller.builtInIds,
        });
        if (!result.ok)
          return {
            ok: false,
            errors: result.errors,
            hint: 'Fix these errors and call create_tutorial again.',
          };
        controller.register(result.tutorial);
        controller.start(result.tutorial.id);
        return { ok: true, id: result.tutorial.id, started: true, active: activeSummary() };
      },
    } satisfies StudioTool<{ tutorial: unknown }>,
    {
      name: 'stop_tutorial',
      title: 'Stop tutorial',
      description: 'Stops the running tutorial, if any.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => {
        const active = activeSummary();
        controller.stop();
        return { stopped: active?.id ?? null };
      },
    } satisfies StudioTool<Record<string, never>>,
  ] as StudioTool<never>[];

  const undo = tools.map((tool) => registry.register(tool));
  return () => {
    controller.stop();
    for (const fn of undo.reverse()) fn();
  };
}
