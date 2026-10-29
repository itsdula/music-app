import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { EngineStoreState } from '../state/engine-store';
import type { ProjectStoreState } from '../state/project-store';
import type { UiState } from '../state/ui-store';
import type { StudioSession } from './studio-session';

const SessionContext = createContext<StudioSession | null>(null);

export function StudioSessionProvider({
  session,
  children,
}: {
  session: StudioSession;
  children: ReactNode;
}) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): StudioSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <StudioSessionProvider>');
  return session;
}

/** Selects from the project store (re-renders only when the selected value changes). */
export function useProjectState<T>(selector: (state: ProjectStoreState) => T): T {
  return useStore(useSession().projectStore, selector);
}

export function useUiState<T>(selector: (state: UiState) => T): T {
  return useStore(useSession().uiStore, selector);
}

export function useEngineState<T>(selector: (state: EngineStoreState) => T): T {
  return useStore(useSession().engineStore, selector);
}
