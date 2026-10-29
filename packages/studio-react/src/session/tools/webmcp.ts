import type { ToolRegistry } from './registry';

/** Exposes the registry on `navigator.modelContext` (WebMCP) when present. (Owned by the assistant workstream.) */
export function connectWebMcp(_registry: ToolRegistry): () => void {
  return () => undefined;
}
