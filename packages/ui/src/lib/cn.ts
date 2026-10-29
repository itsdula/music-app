import { clsx, type ClassValue } from 'clsx';

export type { ClassValue };

/**
 * Joins class names (clsx wrapper). There is no tailwind-merge: a `className` passed to a
 * component is appended, so prefer adding layout utilities over overriding visual ones.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
