import type { ComponentProps, ReactNode } from 'react';

/** Join class names, skipping falsy values. Local helper so landing code stays server-only. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

type CtaVariant = 'primary' | 'secondary' | 'ghost';
type CtaSize = 'sm' | 'lg';

const ctaVariants: Record<CtaVariant, string> = {
  primary:
    'bg-accent text-surface-0 shadow-[0_8px_30px_-12px_rgb(139_124_246/0.7)] hover:bg-accent-strong',
  secondary:
    'border border-line bg-surface-1 text-text hover:border-line-strong hover:bg-surface-2',
  ghost: 'text-text-muted hover:text-text',
};

const ctaSizes: Record<CtaSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-sm',
  lg: 'h-11 gap-2 px-5 text-[15px]',
};

export interface CtaLinkProps extends ComponentProps<'a'> {
  variant?: CtaVariant;
  size?: CtaSize;
}

/**
 * A plain anchor styled as a button. Deliberately not `next/link`: opening `/studio`
 * should be a full page load so the client-only workstation boots fresh.
 */
export function CtaLink({ variant = 'primary', size = 'lg', className, ...props }: CtaLinkProps) {
  return (
    <a
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors duration-150 [&_svg]:size-4 [&_svg]:shrink-0',
        focusRing,
        ctaVariants[variant],
        ctaSizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cx(
        'text-xs font-semibold tracking-[0.14em] text-accent-strong uppercase',
        className,
      )}
    >
      {children}
    </p>
  );
}

export interface SectionHeaderProps {
  id: string;
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Eyebrow + h2 + lead paragraph. `id` goes on the h2 so sections can be `aria-labelledby` it. */
export function SectionHeader({ id, eyebrow, title, children, className }: SectionHeaderProps) {
  return (
    <div className={cx('max-w-2xl', className)}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        id={id}
        className="mt-3 text-3xl font-semibold tracking-tight text-balance text-text sm:text-4xl"
      >
        {title}
      </h2>
      {children ? (
        <div className="mt-4 text-base leading-relaxed text-pretty text-text-muted sm:text-lg">
          {children}
        </div>
      ) : null}
    </div>
  );
}

type PillTone = 'neutral' | 'accent' | 'warning' | 'success';

const pillTones: Record<PillTone, string> = {
  neutral: 'border-line bg-surface-2 text-text-muted',
  accent: 'border-accent/30 bg-accent/10 text-accent-strong',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  success: 'border-success/30 bg-success/10 text-success',
};

export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums',
        pillTones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Page-width container with the standard gutters (16px on phones). */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8', className)}>{children}</div>
  );
}
