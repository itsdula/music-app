/** Navigation tools: switch pages, select tracks, open clips in the editor. UI state only. */
import {
  navigate,
  openClipInEditor,
  selectClips,
  selectTrack,
  STUDIO_VIEWS,
  type BottomPanel,
  type StudioView,
} from '../../state/ui-store';
import type { StudioSession } from '../studio-session';
import type { ToolRegistry } from './registry';
import { defineTool, registerAll, resolveClip, resolveTrack, summarizeView } from './tool-helpers';

/** Destinations that are bottom panels of the arrange page rather than pages of their own. */
const PANEL_DESTINATIONS: Readonly<Record<string, BottomPanel>> = {
  mixer: 'mixer',
  controller: 'controller',
};

const DESTINATIONS: readonly string[] = [
  ...new Set<string>([...STUDIO_VIEWS, ...Object.keys(PANEL_DESTINATIONS)]),
];

function isStudioView(value: string): value is StudioView {
  return (STUDIO_VIEWS as readonly string[]).includes(value);
}

export function registerNavigationTools(
  registry: ToolRegistry,
  session: StudioSession,
): () => void {
  const ui = session.uiStore;
  return registerAll(registry, [
    defineTool<{ view: string }>({
      name: 'navigate',
      title: 'Go to page',
      description:
        'Shows a Studio page: "projects" (project list), "arrange" (timeline with tracks and clips), "editor" (full-height editor for the open clip, or the selected track\'s instrument and effects), "mixer" (volume/pan/effects for every track) or "controller" (MIDI controller mappings).',
      inputSchema: {
        type: 'object',
        properties: { view: { type: 'string', enum: DESTINATIONS, description: 'Page to show.' } },
        required: ['view'],
      },
      run: ({ view }) => {
        if (isStudioView(view)) {
          ui.setState((s) => navigate(s, view));
        } else {
          const panel = PANEL_DESTINATIONS[view]!;
          ui.setState((s) => ({
            ...navigate(s, 'arrange'),
            panels: { ...s.panels, bottomOpen: true, bottomPanel: panel },
          }));
        }
        return summarizeView(session);
      },
    }),
    defineTool<{ trackId: string }>({
      name: 'select_track',
      title: 'Select track',
      description:
        'Selects a track (it becomes the target for live MIDI input and shows its devices in the editor panel).',
      inputSchema: {
        type: 'object',
        properties: { trackId: { type: 'string', description: 'Track id or exact track name.' } },
        required: ['trackId'],
      },
      run: ({ trackId }) => {
        const track = resolveTrack(session, trackId);
        ui.setState((s) => selectTrack(s, track.id));
        return { selected: { id: track.id, name: track.name } };
      },
    }),
    defineTool<{ clipId: string; fullScreen?: boolean }>({
      name: 'open_clip_in_editor',
      title: 'Open clip',
      description:
        'Opens a clip in the editor (piano roll for MIDI, audio/pitch editor for audio) and selects it. fullScreen true switches to the full-height "editor" page; otherwise the editor opens below the arrangement.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'Clip id.' },
          fullScreen: { type: 'boolean', description: 'Default false.' },
        },
        required: ['clipId'],
      },
      run: ({ clipId, fullScreen }) => {
        const clip = resolveClip(session, clipId);
        ui.setState((s) => {
          const next = openClipInEditor(
            selectClips(selectTrack(s, clip.trackId), [clip.id]),
            clip.id,
          );
          return navigate(
            next,
            fullScreen ? 'editor' : next.view === 'projects' ? 'arrange' : next.view,
          );
        });
        return { opened: { id: clip.id, name: clip.name }, view: summarizeView(session) };
      },
    }),
  ]);
}
