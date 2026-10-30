import { useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../lib/cn';

export interface EditableReadoutProps {
  /** The formatted value. */
  text: string;
  /** Name of the control it edits, for the text field. */
  label: string;
  /** Reads typed text; return false to reject it and keep editing. */
  onSubmit?: ((text: string) => boolean) | undefined;
  className?: string;
}

/**
 * A control's value readout. With `onSubmit`, a double click (or Enter while focused) turns it
 * into a text field: Enter applies the typed value, Escape or leaving the field drops it. The
 * `@audio-ui/react` readouts only parse plain numbers, and Studio's controls also take values such
 * as "L30" or "440 Hz".
 */
export function EditableReadout({ text, label, onSubmit, className }: EditableReadoutProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const base = cn('text-[10px] tabular-nums leading-4 text-text-muted', className);

  if (!onSubmit) {
    return (
      <output className={base} aria-hidden>
        {text}
      </output>
    );
  }

  if (draft !== null) {
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === 'Escape') setDraft(null);
      if (event.key === 'Enter' && onSubmit(draft)) setDraft(null);
    };
    return (
      <input
        ref={input}
        aria-label={`${label} value`}
        value={draft}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setDraft(null)}
        className={cn(
          base,
          'w-14 rounded-sm bg-surface-0 px-1 text-center text-text outline-none ring-1 ring-accent',
        )}
      />
    );
  }

  return (
    <button
      type="button"
      tabIndex={-1}
      title="Double-click to type a value"
      aria-label={`${text}, type ${label} value`}
      onDoubleClick={() => setDraft(text)}
      className={cn(base, 'cursor-text rounded-sm px-0.5 hover:text-text')}
    >
      {text}
    </button>
  );
}
