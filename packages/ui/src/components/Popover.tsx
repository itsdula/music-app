import type { ComponentProps } from 'react';
import { Popover as RadixPopover } from 'radix-ui';
import { cn } from '../lib/cn';
import { useStudioPortalContainer } from '../lib/portal';
import { floatingEnter, floatingSurface } from '../lib/styles';

/** Popover root (Radix). Compose with `PopoverTrigger`, `PopoverContent`, `PopoverClose`. */
export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;
export const PopoverClose = RadixPopover.Close;

export function PopoverContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  align = 'center',
  ...props
}: ComponentProps<typeof RadixPopover.Content>) {
  const container = useStudioPortalContainer();
  return (
    <RadixPopover.Portal container={container}>
      <RadixPopover.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        align={align}
        className={cn(floatingSurface, floatingEnter, 'p-3 outline-none', className)}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
