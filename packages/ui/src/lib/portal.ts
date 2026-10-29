import { createContext, use } from 'react';

export const StudioPortalContext = createContext<HTMLElement | null>(null);

/**
 * The portal container from the nearest `StudioPortalProvider`, or `undefined` so that Radix
 * falls back to `document.body`.
 */
export function useStudioPortalContainer(): HTMLElement | undefined {
  return use(StudioPortalContext) ?? undefined;
}
