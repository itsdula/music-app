export interface ScreenshotFrameProps {
  /** Path under `apps/web/public`, e.g. `/screenshots/arrangement.png`. */
  src: string;
  /** Describe what the screenshot shows; required for accessibility. */
  alt: string;
  className?: string;
}

/**
 * Window-style frame for a real product screenshot.
 *
 * Uses a plain <img> so it works without next/image configuration. Images live in
 * `apps/web/public/screenshots/` and are captured from the running app by
 * `scripts/capture-screenshots.mjs` (original demo content only).
 */
export function ScreenshotFrame({ src, alt, className }: ScreenshotFrameProps) {
  return (
    <figure
      className={[
        'overflow-hidden rounded-xl border border-line bg-surface-1 shadow-2xl shadow-black/40',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex h-8 items-center gap-1.5 border-b border-line px-3" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-surface-3" />
        <span className="size-2.5 rounded-full bg-surface-3" />
        <span className="size-2.5 rounded-full bg-surface-3" />
      </div>
      <img src={src} alt={alt} loading="lazy" decoding="async" className="block h-auto w-full" />
    </figure>
  );
}
