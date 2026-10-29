import type { KeyboardEvent } from 'react';
import { snapToStep } from './math';

export interface KeyboardStepOptions {
  value: number;
  min: number;
  max: number;
  step: number;
  fineStep: number;
  largeStep: number;
  /** Value restored by Delete / Backspace (omit to disable). */
  defaultValue?: number;
}

/**
 * Maps slider keys to a new value: arrows (Shift = fine), PageUp/PageDown, Home/End and
 * Delete/Backspace (reset). Returns null for unhandled keys.
 */
export function valueForKey(event: KeyboardEvent, options: KeyboardStepOptions): number | null {
  const { value, min, max, step, fineStep, largeStep, defaultValue } = options;
  const unit = event.shiftKey ? fineStep : step;
  let next: number;
  switch (event.key) {
    case 'ArrowUp':
    case 'ArrowRight':
      next = value + unit;
      break;
    case 'ArrowDown':
    case 'ArrowLeft':
      next = value - unit;
      break;
    case 'PageUp':
      next = value + largeStep;
      break;
    case 'PageDown':
      next = value - largeStep;
      break;
    case 'Home':
      return min;
    case 'End':
      return max;
    case 'Delete':
    case 'Backspace':
      if (defaultValue === undefined) return null;
      return defaultValue;
    default:
      return null;
  }
  return snapToStep(next, unit, min, max);
}
