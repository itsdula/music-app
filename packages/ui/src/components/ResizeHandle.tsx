import type { Ref } from 'react';
import { usePanelResize, type UsePanelResizeOptions } from '../hooks/usePanelResize';
import { cn } from '../lib/cn';

export interface ResizeHandleProps extends UsePanelResizeOptions {
  /** Accessible name, e.g. "Resize mixer". */
  label: string;
  /** id of the panel being resized (aria-controls). */
  controls?: string;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Splitter handle (role="separator") built on `usePanelResize`. Place it between panels; it
 * renders a 1px line with a wider invisible hit area.
 */
export function ResizeHandle({ label, controls, className, ref, ...options }: ResizeHandleProps) {
  const { resizing, handleProps } = usePanelResize(options);
  const alongX = (options.orientation ?? 'vertical') === 'vertical';
  return (
    <div
      ref={ref}
      aria-label={label}
      aria-controls={controls}
      data-resizing={resizing || undefined}
      {...handleProps}
      className={cn(
        'group relative z-10 shrink-0 touch-none select-none outline-none',
        alongX ? '-mx-[3px] w-[7px] cursor-col-resize' : '-my-[3px] h-[7px] cursor-row-resize',
        options.disabled && 'pointer-events-none',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'absolute bg-line motion-safe:transition-colors motion-safe:duration-100 group-hover:bg-accent/60 group-focus-visible:bg-accent group-data-resizing:bg-accent',
          alongX ? 'inset-y-0 left-[3px] w-px' : 'inset-x-0 top-[3px] h-px',
        )}
      />
    </div>
  );
}
