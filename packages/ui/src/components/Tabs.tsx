import type { ComponentProps } from 'react';
import { Tabs as RadixTabs } from 'radix-ui';
import { cn } from '../lib/cn';
import { focusRing, transition } from '../lib/styles';

export interface TabsProps extends Omit<
  ComponentProps<typeof RadixTabs.Root>,
  'value' | 'onValueChange' | 'defaultValue'
> {
  value: string;
  onValueChange: (value: string) => void;
}

/** Controlled tabs (Radix). Compose with `TabsList`, `TabsTrigger` and `TabsContent`. */
export function Tabs({ className, ...props }: TabsProps) {
  return <RadixTabs.Root className={cn('flex flex-col', className)} {...props} />;
}

export function TabsList({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn('flex h-8 shrink-0 items-stretch gap-1 border-b border-line', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        '-mb-px inline-flex select-none items-center gap-1.5 border-b-2 border-transparent px-2 text-[12px] font-medium text-text-muted hover:text-text data-[state=active]:border-accent data-[state=active]:text-text disabled:opacity-40 [&_svg]:size-3.5',
        transition,
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={cn('min-h-0 flex-1', focusRing, className)} {...props} />;
}
