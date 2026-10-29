/**
 * Shared Tailwind class fragments. `.studio-root` already draws a focus outline, but these keep
 * focus visible for content portaled outside it (document.body fallback).
 */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-accent';

/** Restrained colour/opacity transition that collapses under prefers-reduced-motion. */
export const transition =
  'motion-safe:transition-[color,background-color,border-color,opacity,box-shadow] motion-safe:duration-100';

/** Floating surfaces (menus, popovers, tooltips, select content). */
export const floatingSurface =
  'z-50 rounded-md border border-line bg-surface-2 text-text shadow-lg shadow-black/40';

/** Enter animation for floating content (uses @starting-style; reduced motion = instant). */
export const floatingEnter =
  'motion-safe:transition-[opacity,scale] motion-safe:duration-100 motion-safe:starting:opacity-0 motion-safe:starting:scale-[0.97]';

/** Menu item shared by DropdownMenu and ContextMenu. */
export const menuItem =
  'relative flex h-7 cursor-default select-none items-center gap-2 rounded-sm px-2 text-[12px] text-text outline-none data-highlighted:bg-surface-3 data-disabled:pointer-events-none data-disabled:text-text-faint';
