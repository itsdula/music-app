import type { ComponentProps, ReactNode } from 'react';
import { Check, ChevronRight, Dot } from 'lucide-react';
import { DropdownMenu as RadixMenu } from 'radix-ui';
import { cn } from '../lib/cn';
import { useStudioPortalContainer } from '../lib/portal';
import { floatingEnter, floatingSurface, menuItem } from '../lib/styles';
import { Kbd } from './Kbd';

/** Dropdown menu root (Radix). Compose with the `DropdownMenu*` parts below. */
export const DropdownMenu = RadixMenu.Root;
export const DropdownMenuTrigger = RadixMenu.Trigger;
export const DropdownMenuGroup = RadixMenu.Group;
export const DropdownMenuSub = RadixMenu.Sub;
export const DropdownMenuRadioGroup = RadixMenu.RadioGroup;

const contentClasses = cn(floatingSurface, floatingEnter, 'min-w-40 p-1');

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  collisionPadding = 8,
  ...props
}: ComponentProps<typeof RadixMenu.Content>) {
  const container = useStudioPortalContainer();
  return (
    <RadixMenu.Portal container={container}>
      <RadixMenu.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(contentClasses, className)}
        {...props}
      />
    </RadixMenu.Portal>
  );
}

export interface DropdownMenuItemProps extends ComponentProps<typeof RadixMenu.Item> {
  icon?: ReactNode;
  shortcut?: string;
  /** Destructive styling. */
  danger?: boolean;
}

export function DropdownMenuItem({
  icon,
  shortcut,
  danger = false,
  className,
  children,
  ...props
}: DropdownMenuItemProps) {
  return (
    <RadixMenu.Item
      className={cn(
        menuItem,
        '[&_svg]:size-3.5 [&_svg]:text-text-muted',
        danger && 'text-record',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut ? <Kbd className="ml-4">{shortcut}</Kbd> : null}
    </RadixMenu.Item>
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof RadixMenu.CheckboxItem>) {
  return (
    <RadixMenu.CheckboxItem className={cn(menuItem, 'pl-6', className)} {...props}>
      <RadixMenu.ItemIndicator className="absolute left-1.5 inline-flex text-accent">
        <Check className="size-3.5" aria-hidden="true" />
      </RadixMenu.ItemIndicator>
      {children}
    </RadixMenu.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof RadixMenu.RadioItem>) {
  return (
    <RadixMenu.RadioItem className={cn(menuItem, 'pl-6', className)} {...props}>
      <RadixMenu.ItemIndicator className="absolute left-1 inline-flex text-accent">
        <Dot className="size-4" aria-hidden="true" />
      </RadixMenu.ItemIndicator>
      {children}
    </RadixMenu.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof RadixMenu.Label>) {
  return (
    <RadixMenu.Label
      className={cn(
        'px-2 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-text-faint',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof RadixMenu.Separator>) {
  return <RadixMenu.Separator className={cn('-mx-1 my-1 h-px bg-line', className)} {...props} />;
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof RadixMenu.SubTrigger>) {
  return (
    <RadixMenu.SubTrigger
      className={cn(menuItem, 'data-[state=open]:bg-surface-3', className)}
      {...props}
    >
      <span className="flex-1 truncate">{children}</span>
      <ChevronRight className="size-3.5 text-text-muted" aria-hidden="true" />
    </RadixMenu.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  collisionPadding = 8,
  ...props
}: ComponentProps<typeof RadixMenu.SubContent>) {
  const container = useStudioPortalContainer();
  return (
    <RadixMenu.Portal container={container}>
      <RadixMenu.SubContent
        collisionPadding={collisionPadding}
        className={cn(contentClasses, className)}
        {...props}
      />
    </RadixMenu.Portal>
  );
}
