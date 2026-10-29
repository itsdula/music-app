import type { ReactNode } from 'react';
import { StudioPortalContext } from '../lib/portal';
import { TooltipProvider } from './Tooltip';

export { useStudioPortalContainer } from '../lib/portal';

export interface StudioPortalProviderProps {
  /**
   * Element that overlays (Tooltip, menus, Dialog, Popover, Select) portal into. Pass the
   * `.studio-root` element (or a child of it) so portaled content inherits its scoped base
   * styles. `null` (e.g. before the element has mounted) falls back to `document.body`.
   */
  container: HTMLElement | null;
  /** Tooltip hover delay for the subtree (ms). Default 500. */
  tooltipDelay?: number;
  children?: ReactNode;
}

/** Supplies the overlay portal container and a shared tooltip group to its subtree. */
export function StudioPortalProvider({
  container,
  tooltipDelay,
  children,
}: StudioPortalProviderProps) {
  return (
    <StudioPortalContext value={container}>
      <TooltipProvider delayDuration={tooltipDelay}>{children}</TooltipProvider>
    </StudioPortalContext>
  );
}
