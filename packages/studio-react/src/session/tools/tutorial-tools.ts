import type { StudioSession } from '../studio-session';
import type { ToolRegistry } from './registry';

/** Tutorial tools (start, create on the fly). (Owned by the tutorial workstream.) */
export function registerTutorialTools(
  _registry: ToolRegistry,
  _session: StudioSession,
): () => void {
  return () => undefined;
}
