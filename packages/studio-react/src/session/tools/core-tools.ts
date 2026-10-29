import type { StudioSession } from '../studio-session';
import type { ToolRegistry } from './registry';

/** Project, track, clip, note, transport and navigation tools. (Owned by the assistant workstream.) */
export function registerCoreTools(_registry: ToolRegistry, _session: StudioSession): () => void {
  return () => undefined;
}
