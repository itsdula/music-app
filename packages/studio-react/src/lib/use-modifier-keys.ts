import { useEffect, useRef } from 'react';

/**
 * Calls `onChange(altKey)` whenever Alt/Option is pressed or released anywhere in the window,
 * so hover cursors (e.g. `copy` for Alt-duplicate) update without moving the pointer.
 */
export function useAltKey(onChange: (alt: boolean) => void): void {
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Alt') callback.current(e.type === 'keydown');
    };
    const onBlur = () => callback.current(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
