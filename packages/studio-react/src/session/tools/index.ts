/**
 * Installs every built-in tool group and the WebMCP bridge. Each group lives in its own file
 * so features can add capabilities without touching each other.
 */
import type { StudioSession } from '../studio-session';
import { registerCoreTools } from './core-tools';
import { registerTutorialTools } from './tutorial-tools';
import { connectWebMcp } from './webmcp';

export function installStudioTools(session: StudioSession): () => void {
  const undo = [
    registerCoreTools(session.tools, session),
    registerTutorialTools(session.tools, session),
    connectWebMcp(session.tools),
  ];
  return () => {
    for (const fn of undo.reverse()) fn();
  };
}

export * from './registry';
