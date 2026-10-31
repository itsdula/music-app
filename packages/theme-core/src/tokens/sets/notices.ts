import { ref, type TokenDef } from '../registry';
import { setColor } from './helpers';

const c = setColor('notices', { utility: true });

/** NoticeBar, LearnBanner, save status, toasts and the dev monitor's log levels. */
export const NOTICES_TOKENS: readonly TokenDef[] = [
  c('notice', ref('card')),
  c('notice-border', ref('border')),
  ...(
    [
      ['info', 'info'],
      ['warning', 'warning'],
      ['error', 'destructive'],
      ['success', 'success'],
    ] as const
  ).flatMap(([role, base]) => [
    c(`notice-${role}`, ref(`${base}-soft`)),
    c(`notice-${role}-foreground`, ref(`${base}-soft-foreground`)),
  ]),
  c('notice-learn', ref('primary-soft')),
  c('notice-learn-border', ref('primary', 0.4)),
  c('log-debug', ref('faint-foreground')),
  c('log-info', ref('info')),
  c('log-warn', ref('warning')),
  c('log-error', ref('destructive')),
];
