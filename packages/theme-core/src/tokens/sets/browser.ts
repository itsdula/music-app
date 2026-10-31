import { ref, type TokenDef } from '../registry';
import { setColor } from './helpers';

const c = setColor('browser', { utility: true });

/** The browser panel uses the global `sidebar-*` tokens plus its drop target. */
export const BROWSER_TOKENS: readonly TokenDef[] = [c('browser-drop-target', ref('primary', 0.15))];
