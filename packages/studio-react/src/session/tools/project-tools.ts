/** Project, history and transport tools: tempo, meter, loop, undo/redo, play/stop/seek, projects. */
import { MAX_BPM, MIN_BPM, ticksPerBar, ticksPerBeat, type ProjectId } from '@studio/domain';
import { navigate } from '../../state/ui-store';
import type { StudioSession } from '../studio-session';
import type { ToolRegistry } from './registry';
import {
  barToTick,
  defineTool,
  executeEdit,
  fail,
  meterLabel,
  registerAll,
  tickToBar,
} from './tool-helpers';

const DENOMINATORS = [1, 2, 4, 8, 16, 32] as const;

export function registerProjectTools(registry: ToolRegistry, session: StudioSession): () => void {
  const { history, transport } = session;
  const position = () => {
    const meter = history.present.meter;
    const engine = session.engineStore.getState();
    const tick = transport.isPlaying
      ? session.engine.getTransportPosition().ticks
      : engine.cursorTick;
    return { state: engine.playState, positionBar: tickToBar(tick, meter) };
  };

  const openedProjectResult = () => {
    session.uiStore.setState((s) => navigate(s, 'arrange'));
    const project = history.present;
    return { projectId: project.id, name: project.name, tracks: project.trackOrder.length };
  };

  return registerAll(registry, [
    // --- project settings ---------------------------------------------------------------
    defineTool<{ bpm: number }>({
      name: 'set_tempo',
      title: 'Set tempo',
      description: `Sets the project tempo in BPM (${MIN_BPM}-${MAX_BPM}). Typical: house 120-128, hip-hop 85-95, drum & bass 170-175.`,
      inputSchema: {
        type: 'object',
        properties: { bpm: { type: 'number', minimum: MIN_BPM, maximum: MAX_BPM } },
        required: ['bpm'],
      },
      run: ({ bpm }) => {
        transport.setTempo(bpm);
        return { tempoBpm: history.present.bpm };
      },
    }),
    defineTool<{ numerator: number; denominator: number }>({
      name: 'set_time_signature',
      title: 'Set time signature',
      description:
        'Sets the time signature, e.g. 4/4, 3/4 or 6/8. Clip positions stay at the same ticks, so bar numbers of existing clips may change.',
      inputSchema: {
        type: 'object',
        properties: {
          numerator: { type: 'integer', minimum: 1, maximum: 32, description: 'Beats per bar.' },
          denominator: { type: 'integer', enum: DENOMINATORS, description: 'Beat unit.' },
        },
        required: ['numerator', 'denominator'],
      },
      run: ({ numerator, denominator }) => {
        executeEdit(
          session,
          [
            {
              type: 'project.setMeter',
              meter: { numerator, denominator: denominator as (typeof DENOMINATORS)[number] },
            },
          ],
          'Set Time Signature',
        );
        return { timeSignature: meterLabel(history.present.meter) };
      },
    }),
    defineTool<{ startBar: number; endBar?: number; lengthBars?: number; enabled?: boolean }>({
      name: 'set_loop',
      title: 'Set loop',
      description:
        'Sets the loop region in bars (1-based; endBar is exclusive, so startBar 1 + lengthBars 4 loops bars 1-4) and turns looping on (or off with enabled false).',
      inputSchema: {
        type: 'object',
        properties: {
          startBar: { type: 'number', minimum: 1 },
          endBar: { type: 'number', minimum: 1, description: 'Exclusive end bar.' },
          lengthBars: { type: 'number', minimum: 0.25, description: 'Alternative to endBar.' },
          enabled: { type: 'boolean', description: 'Default true.' },
        },
        required: ['startBar'],
      },
      run: ({ startBar, endBar, lengthBars, enabled }) => {
        const meter = history.present.meter;
        const startTick = barToTick(startBar, meter);
        const endTick =
          endBar !== undefined
            ? barToTick(endBar, meter)
            : startTick + Math.round((lengthBars ?? 4) * ticksPerBar(meter));
        if (endTick <= startTick) fail('The loop end must be after its start.');
        executeEdit(
          session,
          [{ type: 'project.setLoop', loop: { startTick, endTick, enabled: enabled ?? true } }],
          'Set Loop',
        );
        const loop = history.present.loop;
        return {
          loop: {
            enabled: loop.enabled,
            startBar: tickToBar(loop.startTick, meter),
            endBar: tickToBar(loop.endTick, meter),
          },
        };
      },
    }),
    defineTool<{ name: string }>({
      name: 'rename_project',
      title: 'Rename project',
      description: 'Renames the open project (shown in the toolbar and the project list).',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      run: ({ name }) => {
        if (!name.trim()) fail('The project name cannot be empty.');
        session.projects.rename(name);
        return { name: history.present.name };
      },
    }),
    defineTool<{ template?: string; name?: string }>({
      name: 'new_project',
      title: 'New project',
      description:
        'Saves the open project and creates a new one ("empty": one Keys track; "demo": a short drums/bass/keys groove), then shows the arrange page. Switching projects clears undo history.',
      inputSchema: {
        type: 'object',
        properties: {
          template: { type: 'string', enum: ['empty', 'demo'], description: 'Default "empty".' },
          name: { type: 'string', description: 'Optional project name.' },
        },
      },
      run: async ({ template, name }) => {
        await session.projects.newProject(template === 'demo' ? 'demo' : 'empty');
        if (name?.trim()) session.projects.rename(name);
        return openedProjectResult();
      },
    }),
    defineTool<{ projectId: string }>({
      name: 'open_project',
      title: 'Open project',
      description:
        'Saves the open project and opens another saved project (id or exact name from list_projects), then shows the arrange page. Switching projects clears undo history.',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string', description: 'Project id or exact name.' } },
        required: ['projectId'],
      },
      run: async ({ projectId }) => {
        const projects = await session.projects.list();
        const wanted = projectId.trim().toLowerCase();
        const match =
          projects.find((p) => p.id === projectId) ??
          projects.find((p) => p.name.toLowerCase() === wanted);
        if (!match) {
          fail(
            `Project "${projectId}" not found. Saved projects: ${projects
              .slice(0, 20)
              .map((p) => `"${p.name}" (${p.id})`)
              .join(', ')}.`,
          );
        }
        await session.projects.flush();
        await session.projects.open(match.id as ProjectId);
        return openedProjectResult();
      },
    }),
    // --- history ------------------------------------------------------------------------
    defineTool<Record<string, never>>({
      name: 'undo',
      title: 'Undo',
      description: 'Undoes the most recent edit (by the user or by a tool).',
      inputSchema: { type: 'object', properties: {} },
      run: () => {
        const label = history.undoLabel;
        if (!history.undo()) fail('Nothing to undo.');
        return { undone: label ?? 'edit', canUndo: history.canUndo };
      },
    }),
    defineTool<Record<string, never>>({
      name: 'redo',
      title: 'Redo',
      description: 'Redoes the most recently undone edit (after undo).',
      inputSchema: { type: 'object', properties: {} },
      run: () => {
        const label = history.redoLabel;
        if (!history.redo()) fail('Nothing to redo.');
        return { redone: label ?? 'edit', canRedo: history.canRedo };
      },
    }),
    // --- transport ----------------------------------------------------------------------
    defineTool<{ fromBar?: number }>({
      name: 'play',
      title: 'Play',
      description:
        'Starts playback (from fromBar, or from the playhead). Browsers may block audio until the user has clicked the page.',
      inputSchema: {
        type: 'object',
        properties: { fromBar: { type: 'number', minimum: 1, description: '1-based bar.' } },
      },
      run: async ({ fromBar }) => {
        const meter = history.present.meter;
        await transport.play(fromBar !== undefined ? barToTick(fromBar, meter) : undefined);
        if (!transport.isPlaying)
          fail('Audio could not start. Ask the user to click anywhere in Nawa, then try again.');
        return position();
      },
    }),
    defineTool<Record<string, never>>({
      name: 'stop',
      title: 'Stop',
      description: 'Stops playback (and recording, if active).',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        await transport.stop();
        return position();
      },
    }),
    defineTool<{ bar: number; beat?: number }>({
      name: 'seek',
      title: 'Move playhead',
      description: 'Moves the playhead to a bar (1-based) and optional beat (1-based).',
      inputSchema: {
        type: 'object',
        properties: {
          bar: { type: 'number', minimum: 1 },
          beat: { type: 'number', minimum: 1, description: 'Default 1.' },
        },
        required: ['bar'],
      },
      run: async ({ bar, beat }) => {
        const meter = history.present.meter;
        const tick = barToTick(bar, meter) + Math.round(((beat ?? 1) - 1) * ticksPerBeat(meter));
        await transport.seek(tick);
        return position();
      },
    }),
  ]);
}
