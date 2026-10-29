import { clsx } from 'clsx';
import { resolveStudioConfig, type StudioProps } from './config';

/**
 * The portable Studio entry point. Mount it in any React 19 host (Next.js client
 * boundary, Vite, Electron renderer) after importing '@studio/react/styles.css'.
 */
export function Studio({ className, style, config }: StudioProps) {
  const resolved = resolveStudioConfig(config);
  return (
    <div
      className={clsx('studio-root flex h-full min-h-[480px] w-full flex-col', className)}
      style={style}
      data-testid="studio-root"
      data-undo-limit={resolved.undoLimit}
    >
      <div className="flex flex-1 items-center justify-center text-text-muted">
        Studio is starting…
      </div>
    </div>
  );
}
