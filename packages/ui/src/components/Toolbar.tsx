import type { ComponentProps, KeyboardEvent } from 'react';
import { cn } from '../lib/cn';

export interface ToolbarProps extends ComponentProps<'div'> {
  /** Accessible name of the toolbar. */
  'aria-label': string;
  orientation?: 'horizontal' | 'vertical';
}

const FOCUSABLE =
  'button:not(:disabled), [role="slider"]:not([aria-disabled="true"]), input:not(:disabled), select:not(:disabled), a[href]';

/**
 * Container with role="toolbar". Every control stays in the Tab order; additionally, arrow
 * keys move focus between buttons (controls that use arrows themselves keep them).
 */
export function Toolbar({
  orientation = 'horizontal',
  className,
  onKeyDown,
  ...props
}: ToolbarProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.tagName !== 'BUTTON' || target.getAttribute('role') === 'radio') return;
    const forward = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    const backward = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    if (event.key !== forward && event.key !== backward) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    const index = items.indexOf(target);
    if (index === -1 || items.length < 2) return;
    event.preventDefault();
    const delta = event.key === forward ? 1 : -1;
    items[(index + delta + items.length) % items.length]?.focus();
  };

  return (
    <div
      role="toolbar"
      aria-orientation={orientation}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex items-center gap-2',
        orientation === 'vertical' ? 'flex-col' : 'flex-row',
        className,
      )}
      {...props}
    />
  );
}

export interface ToolbarGroupProps extends ComponentProps<'div'> {
  /** Optional accessible name for the group. */
  'aria-label'?: string;
}

/** Visually tight cluster of related toolbar controls. */
export function ToolbarGroup({ className, ...props }: ToolbarGroupProps) {
  return <div role="group" className={cn('flex items-center gap-0.5', className)} {...props} />;
}

export interface ToolbarSeparatorProps extends ComponentProps<'div'> {
  /** Orientation of the separator line (perpendicular to the toolbar). Default vertical. */
  orientation?: 'vertical' | 'horizontal';
}

export function ToolbarSeparator({
  orientation = 'vertical',
  className,
  ...props
}: ToolbarSeparatorProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0 bg-line',
        orientation === 'vertical' ? 'mx-1 h-4 w-px' : 'my-1 h-px w-4',
        className,
      )}
      {...props}
    />
  );
}
