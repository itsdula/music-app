import type { ComponentProps } from 'react';
import { VisuallyHidden as RadixVisuallyHidden } from 'radix-ui';

export type VisuallyHiddenProps = ComponentProps<typeof RadixVisuallyHidden.Root>;

/** Content available to assistive technology but not rendered visually. */
export function VisuallyHidden(props: VisuallyHiddenProps) {
  return <RadixVisuallyHidden.Root {...props} />;
}
