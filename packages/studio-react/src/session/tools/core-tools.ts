/**
 * Core Studio tools, shared by the AI assistant, WebMCP and tutorials. Grouped by area:
 *   - read-tools:       project summary, tracks, clip notes, projects, selection, catalogs
 *   - navigation-tools: pages, track selection, opening clips in the editor
 *   - project-tools:    tempo, meter, loop, projects, undo/redo, transport
 *   - track-tools:      tracks, instruments, effects
 *   - clip-tools:       MIDI clips, notes, chord progressions, drum patterns
 * Every edit goes through `session.history` (one undo entry per tool call).
 */
import type { StudioSession } from '../studio-session';
import { registerClipTools } from './clip-tools';
import { registerNavigationTools } from './navigation-tools';
import { registerProjectTools } from './project-tools';
import { registerReadTools } from './read-tools';
import type { ToolRegistry } from './registry';
import { registerTrackTools } from './track-tools';

export function registerCoreTools(registry: ToolRegistry, session: StudioSession): () => void {
  const undo = [
    registerReadTools(registry, session),
    registerNavigationTools(registry, session),
    registerProjectTools(registry, session),
    registerTrackTools(registry, session),
    registerClipTools(registry, session),
  ];
  return () => {
    for (const fn of undo.reverse()) fn();
  };
}
