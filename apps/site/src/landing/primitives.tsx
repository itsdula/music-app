import type { ComponentProps, PointerEvent, ReactNode } from 'react';

/** Join class names, skipping falsy values. Local helper so the landing does not pull in the Studio UI package. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong';

type CtaVariant = 'primary' | 'secondary' | 'ghost';
type CtaSize = 'sm' | 'lg';

const ctaVariants: Record<CtaVariant, string> = {
  primary:
    'bg-text text-ink shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_10px_40px_-10px_rgb(139_124_246/0.75)] hover:bg-white hover:shadow-[0_0_0_1px_rgb(255_255_255/0.2),0_14px_50px_-8px_rgb(139_124_246/0.9)]',
  secondary:
    'border border-white/12 bg-white/[0.04] text-text backdrop-blur-sm hover:border-white/25 hover:bg-white/[0.08]',
  ghost: 'text-text-muted hover:text-text',
};

const ctaSizes: Record<CtaSize, string> = {
  sm: 'h-8 gap-1.5 px-3.5 text-[13px]',
  lg: 'h-12 gap-2 px-6 text-[15px]',
};

export interface CtaLinkProps extends ComponentProps<'a'> {
  variant?: CtaVariant;
  size?: CtaSize;
}

/**
 * A plain anchor styled as a button: the landing and the Studio are separate pages, so
 * opening the Studio is a full page load and the workstation boots fresh. Put an icon in
 * `.nawa-cta-arrow` to get the hover nudge.
 */
export function CtaLink({ variant = 'primary', size = 'lg', className, ...props }: CtaLinkProps) {
  return (
    <a
      className={cx(
        'nawa-cta inline-flex shrink-0 items-center justify-center rounded-full font-medium whitespace-nowrap [&_svg]:size-4 [&_svg]:shrink-0',
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
        'inline-flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.18em] text-accent-strong uppercase',
        className,
      )}
    >
      <span aria-hidden="true" className="h-px w-5 bg-accent-strong/60" />
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
  align?: 'start' | 'center';
}

/** Eyebrow + h2 + lead paragraph. `id` goes on the h2 so sections can be `aria-labelledby` it. */
export function SectionHeader({
  id,
  eyebrow,
  title,
  children,
  className,
  align = 'start',
}: SectionHeaderProps) {
  return (
    <div
      className={cx(
        'max-w-2xl',
        align === 'center' && 'mx-auto flex flex-col items-center text-center',
        className,
      )}
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        id={id}
        className="mt-4 text-[2rem] leading-[1.08] font-semibold tracking-[-0.03em] text-balance text-text sm:text-5xl"
      >
        {title}
      </h2>
      {children ? (
        <div className="mt-5 text-base leading-relaxed text-pretty text-text-muted sm:text-lg">
          {children}
        </div>
      ) : null}
    </div>
  );
}

type PillTone = 'neutral' | 'accent' | 'warning' | 'success';

const pillTones: Record<PillTone, string> = {
  neutral: 'border-white/10 bg-white/[0.04] text-text-muted',
  accent: 'border-accent/30 bg-accent/10 text-accent-strong',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  success: 'border-success/30 bg-success/10 text-success',
};

export function Pill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums',
        pillTones[tone],
        className,
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

/**
 * Feeds the pointer position into the `.nawa-spotlight` glow as CSS custom properties.
 * Setting a custom property only repaints the pseudo-element; it never triggers layout.
 */
export function trackSpotlight(event: PointerEvent<HTMLElement>): void {
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
  el.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
}

/** The Nawa mark: a sound wave resolving into a single sustained note. */
export function NawaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="nawa-mark-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a397ff" />
          <stop offset="1" stopColor="#6c5ce7" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="23" height="23" rx="7" fill="url(#nawa-mark-fill)" />
      <path
        d="M5.5 12h1.6l1.5-4.2 2.2 8.6 2.1-6.6 1.5 3.4.9-1.2H18.5"
        fill="none"
        stroke="#0a0b0f"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** GitHub's mark, drawn inline (lucide dropped brand icons). */
export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}
