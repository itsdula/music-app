import type { ReactNode } from 'react';
import { sitePath } from '../urls';
import { cx } from './primitives';

/**
 * Intrinsic sizes of the screenshots, so the browser reserves space before they load. The
 * captures are 2x (see the capture notes below), so they stay sharp on high-DPI screens.
 */
const SIZES: Record<string, { width: number; height: number }> = {
  'screenshots/studio-overview.webp': { width: 3200, height: 1800 },
  'screenshots/studio-overview-mobile.webp': { width: 1520, height: 830 },
  'screenshots/piano-roll.webp': { width: 1934, height: 494 },
  'screenshots/piano-roll-mobile.webp': { width: 990, height: 430 },
  'screenshots/vocal-editor.webp': { width: 1934, height: 534 },
  'screenshots/vocal-editor-mobile.webp': { width: 1000, height: 420 },
  'screenshots/controller.webp': { width: 1684, height: 460 },
  'screenshots/controller-mobile.webp': { width: 755, height: 440 },
};

/** Phones get the `mobileSrc` crop; this matches Tailwind's `sm` breakpoint. */
const PHONE_MEDIA = '(max-width: 639px)';

export interface ScreenshotFrameProps {
  /** Path under `apps/site/public`, without a leading slash, e.g. `screenshots/piano-roll.webp`. */
  src: string;
  /**
   * A tighter crop of the same capture for phones, where the full-width image would shrink
   * to unreadable UI text. Same subject, so the alt text still applies.
   */
  mobileSrc?: string;
  /** Describe what the screenshot shows; required for accessibility. */
  alt: string;
  /** Optional caption shown in the window's title bar (decorative). */
  title?: string;
  /** The hero image is above the fold, so it loads eagerly; everything else is lazy. */
  loading?: 'eager' | 'lazy';
  /** Decorative layer drawn over the image, positioned against it. */
  overlay?: ReactNode;
  className?: string;
}

/**
 * Window-style frame for a real product screenshot.
 *
 * The URLs are resolved against the site base path. Images live in
 * `apps/site/public/screenshots/` and are captures of the running Studio (the built-in demo
 * project plus a synthesized vocal phrase; original content only), cropped to the part
 * each section talks about and encoded as WebP.
 */
export function ScreenshotFrame({
  src,
  mobileSrc,
  alt,
  title,
  loading = 'lazy',
  overlay,
  className,
}: ScreenshotFrameProps) {
  const mobileSize = mobileSrc ? SIZES[mobileSrc] : undefined;
  return (
    <figure
      className={cx(
        'nawa-hairline overflow-hidden rounded-2xl bg-ink-raised shadow-[0_40px_120px_-40px_rgb(0_0_0/0.9),0_0_0_1px_rgb(0_0_0/0.5)]',
        className,
      )}
    >
      <div
        className="relative flex h-8 items-center gap-1.5 border-b border-white/[0.06] bg-white/[0.02] px-3.5 sm:h-9"
        aria-hidden="true"
      >
        <span className="size-2.5 rounded-full bg-[#ff5f57]/80" />
        <span className="size-2.5 rounded-full bg-[#febc2e]/80" />
        <span className="size-2.5 rounded-full bg-[#28c840]/80" />
        {title ? (
          <span className="absolute inset-x-0 text-center font-mono text-[11px] text-text-muted">
            {title}
          </span>
        ) : null}
      </div>
      <div className="relative">
        <picture>
          {mobileSrc ? (
            <source
              media={PHONE_MEDIA}
              srcSet={sitePath(mobileSrc)}
              width={mobileSize?.width}
              height={mobileSize?.height}
            />
          ) : null}
          <img
            src={sitePath(src)}
            alt={alt}
            loading={loading}
            width={SIZES[src]?.width}
            height={SIZES[src]?.height}
            decoding="async"
            className="block h-auto w-full"
          />
        </picture>
        {overlay}
      </div>
    </figure>
  );
}
