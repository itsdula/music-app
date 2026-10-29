import { StudioPortalProvider } from '@studio/ui';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { resolveStudioConfig, type PlatformProvider, type StudioProps } from './config';
import { StudioShell } from './components/StudioShell';
import { StartupScreen } from './components/StartupScreen';
import { createDefaultPlatform } from './platform/default-platform';
import { StudioSessionProvider } from './session/context';
import { createStudioSession, type StudioSession } from './session/studio-session';

type BootState =
  | { readonly status: 'booting' }
  | { readonly status: 'ready'; readonly session: StudioSession }
  | { readonly status: 'error'; readonly message: string };

async function resolvePlatform(provider: PlatformProvider | undefined) {
  if (!provider) return createDefaultPlatform();
  return typeof provider === 'function' ? provider() : provider;
}

/**
 * The portable Studio entry point. Mount it in any React 19 host (Next.js client boundary,
 * Vite, Electron renderer) after importing '@studio/react/styles.css'. `platform` and
 * `config` are read once at mount.
 */
export function Studio({ className, style, config, platform }: StudioProps) {
  const [boot, setBoot] = useState<BootState>({ status: 'booting' });
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  // Props are captured once at mount; later changes are intentionally ignored.
  const [mount] = useState(() => ({ config: resolveStudioConfig(config), platform }));

  useEffect(() => {
    let cancelled = false;
    let session: StudioSession | null = null;
    void (async () => {
      try {
        const services = await resolvePlatform(mount.platform);
        if (cancelled) {
          await services.dispose();
          return;
        }
        session = createStudioSession(services, mount.config);
        await session.start();
        if (cancelled) return;
        setBoot({ status: 'ready', session });
      } catch (error) {
        if (!cancelled)
          setBoot({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
      }
    })();
    return () => {
      cancelled = true;
      if (session) void session.dispose();
    };
  }, [mount]);

  return (
    <div
      className={clsx(
        'studio-root relative flex h-full min-h-[480px] w-full flex-col overflow-hidden select-none',
        className,
      )}
      style={style}
      data-testid="studio-root"
      data-studio-status={boot.status}
    >
      {boot.status === 'ready' ? (
        <StudioSessionProvider session={boot.session}>
          <StudioPortalProvider container={portalContainer}>
            <StudioShell />
          </StudioPortalProvider>
        </StudioSessionProvider>
      ) : (
        <StartupScreen
          status={boot.status}
          message={boot.status === 'error' ? boot.message : undefined}
        />
      )}
      <div ref={setPortalContainer} className="studio-portal-root" />
    </div>
  );
}
