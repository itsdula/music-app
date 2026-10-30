import { useEffect, useRef, type CSSProperties } from 'react';

export interface RenameFieldProps {
  readonly defaultValue: string;
  /** Called with the new value on Enter or blur (not on Escape). */
  readonly onCommit: (value: string) => void;
  /** Called after commit or cancel. */
  readonly onDone: () => void;
  readonly label: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

/**
 * Inline rename input, typically opened from a context menu. Focus is taken on the next
 * task so the closing menu (which traps and then restores focus) cannot steal it, and blur
 * only commits once the field actually had focus.
 */
export function RenameField({
  defaultValue,
  onCommit,
  onDone,
  label,
  className,
  style,
  testId,
}: RenameFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  const focused = useRef(false);
  const finished = useRef(false);

  useEffect(() => {
    const id = setTimeout(() => {
      ref.current?.focus({ preventScroll: true });
      ref.current?.select();
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commit && ref.current) onCommit(ref.current.value);
    onDone();
  };

  return (
    <input
      ref={ref}
      className={className}
      style={style}
      defaultValue={defaultValue}
      aria-label={label}
      data-testid={testId}
      onFocus={() => {
        focused.current = true;
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => {
        if (focused.current) finish(true);
      }}
    />
  );
}
