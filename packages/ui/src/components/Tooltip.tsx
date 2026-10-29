import { createContext, use, type ReactElement, type ReactNode } from 'react';
import { Tooltip as RadixTooltip } from 'radix-ui';
import { cn } from '../lib/cn';
import { floatingEnter } from '../lib/styles';
import { Kbd } from './Kbd';
import { useStudioPortalContainer } from '../lib/portal';

const TooltipGroupContext = createContext(false);

export interface TooltipProviderProps {
  /** Hover delay before opening (ms). Default 500. */
  delayDuration?: number;
  /** Window in which moving to another trigger opens instantly (ms). Default 300. */
  skipDelayDuration?: number;
  children?: ReactNode;
}

/**
 * Groups tooltips so that moving between triggers skips the delay. Included by
 * `StudioPortalProvider`; a `Tooltip` rendered outside any provider creates its own.
 */
export function TooltipProvider({
  delayDuration = 500,
  skipDelayDuration = 300,
  children,
}: TooltipProviderProps) {
  return (
    <RadixTooltip.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration}>
      <TooltipGroupContext value={true}>{children}</TooltipGroupContext>
    </RadixTooltip.Provider>
  );
}

export interface TooltipProps {
  /** Tooltip text/content. When empty, only the trigger renders. */
  content: ReactNode;
  /** Optional keyboard shortcut shown after the content, e.g. "Space" or "⌘S". */
  shortcut?: string;
  /** A single focusable element; receives the tooltip via `asChild`. */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  delayDuration?: number;
  className?: string;
}

export function Tooltip({
  content,
  shortcut,
  children,
  side = 'top',
  align = 'center',
  sideOffset = 6,
  open,
  onOpenChange,
  delayDuration,
  className,
}: TooltipProps) {
  const container = useStudioPortalContainer();
  const grouped = use(TooltipGroupContext);
  if (content == null || content === '' || content === false) return children;

  const tooltip = (
    <RadixTooltip.Root open={open} onOpenChange={onOpenChange} delayDuration={delayDuration}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal container={container}>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          className={cn(
            'z-50 flex max-w-64 select-none items-center gap-2 rounded-sm border border-line bg-surface-3 px-2 py-1 text-[11px] leading-4 text-text shadow-md shadow-black/40',
            floatingEnter,
            className,
          )}
        >
          <span>{content}</span>
          {shortcut ? <Kbd>{shortcut}</Kbd> : null}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );

  return grouped ? tooltip : <TooltipProvider>{tooltip}</TooltipProvider>;
}
