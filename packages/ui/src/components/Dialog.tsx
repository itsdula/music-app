import type { ComponentProps, ReactNode } from 'react';
import { X } from 'lucide-react';
import { Dialog as RadixDialog, VisuallyHidden as RadixVisuallyHidden } from 'radix-ui';
import { cn } from '../lib/cn';
import { useStudioPortalContainer } from '../lib/portal';
import { floatingEnter, focusRing, transition } from '../lib/styles';

/** Modal dialog root (Radix). Control with `open` / `onOpenChange`. */
export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export interface DialogContentProps extends Omit<
  ComponentProps<typeof RadixDialog.Content>,
  'title'
> {
  /** Dialog title (required for an accessible name). */
  title: ReactNode;
  description?: ReactNode;
  /** Keep the title for assistive technology only. */
  hideTitle?: boolean;
  /** Render the close (X) button. Default true. */
  showClose?: boolean;
  /** Width utility. Default `w-[min(28rem,calc(100vw-2rem))]`. */
  widthClassName?: string;
}

export function DialogContent({
  title,
  description,
  hideTitle = false,
  showClose = true,
  widthClassName = 'w-[min(28rem,calc(100vw-2rem))]',
  className,
  children,
  ...props
}: DialogContentProps) {
  const container = useStudioPortalContainer();
  const titleNode = (
    <RadixDialog.Title className="text-[13px] font-semibold text-text">{title}</RadixDialog.Title>
  );
  return (
    <RadixDialog.Portal container={container}>
      <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60 motion-safe:transition-opacity motion-safe:duration-150 motion-safe:starting:opacity-0" />
      <RadixDialog.Content
        aria-describedby={description ? undefined : props['aria-describedby']}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-auto rounded-lg border border-line bg-surface-1 p-4 text-text shadow-2xl shadow-black/60 outline-none',
          floatingEnter,
          widthClassName,
          className,
        )}
        {...props}
      >
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {hideTitle ? (
              <RadixVisuallyHidden.Root>{titleNode}</RadixVisuallyHidden.Root>
            ) : (
              titleNode
            )}
            {description ? (
              <RadixDialog.Description className="text-[12px] text-text-muted">
                {description}
              </RadixDialog.Description>
            ) : null}
          </div>
          {showClose ? (
            <RadixDialog.Close
              aria-label="Close"
              className={cn(
                '-mt-1 -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text',
                transition,
                focusRing,
              )}
            >
              <X className="size-3.5" aria-hidden="true" />
            </RadixDialog.Close>
          ) : null}
        </div>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mt-1 flex items-center justify-end gap-2', className)} {...props} />;
}
