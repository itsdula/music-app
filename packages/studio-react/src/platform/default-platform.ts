/**
 * The only module allowed to import @studio/platform-browser (enforced by
 * dependency-cruiser). Loaded lazily so hosts that inject their own platform never pay
 * for browser adapters they don't use.
 */
import type { PlatformServices } from '@studio/platform-contracts';

export async function createDefaultPlatform(): Promise<PlatformServices> {
  const { createBrowserPlatform } = await import('@studio/platform-browser');
  return createBrowserPlatform();
}
