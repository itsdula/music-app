import { createMemoryKeyValueStore } from '@studio/project-storage';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_CONFIG } from '../src/config';
import { usePersistentToggle } from '../src/lib/use-persistent-toggle';
import { StudioSessionProvider } from '../src/session/context';
import { createStudioSession, type StudioSession } from '../src/session/studio-session';
import { createTestPlatform } from './helpers/test-platform';

let session: StudioSession | undefined;
afterEach(async () => {
  await session?.dispose();
  session = undefined;
});

function setup(initial: Record<string, string> = {}) {
  const preferences = createMemoryKeyValueStore({ initial });
  session = createStudioSession(createTestPlatform({ preferences }), DEFAULT_STUDIO_CONFIG);
  const current = session;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StudioSessionProvider session={current}>{children}</StudioSessionProvider>
  );
  return { preferences, wrapper };
}

describe('usePersistentToggle', () => {
  it('starts from the fallback and stores toggles as ui.<key> = 1/0', () => {
    const { preferences, wrapper } = setup();
    const { result } = renderHook(() => usePersistentToggle('lane', true), { wrapper });
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(preferences.get('ui.lane')).toBe('0');
    act(() => result.current[1](true));
    expect(preferences.get('ui.lane')).toBe('1');
  });

  it('reads the stored value over the fallback', () => {
    const { wrapper } = setup({ 'ui.lane': '1' });
    const { result } = renderHook(() => usePersistentToggle('lane', false), { wrapper });
    expect(result.current[0]).toBe(true);
  });

  it('follows changes made elsewhere (another component, tab or window)', () => {
    const { preferences, wrapper } = setup();
    const { result } = renderHook(() => usePersistentToggle('lane', false), { wrapper });
    act(() => preferences.receive('ui.lane', '1'));
    expect(result.current[0]).toBe(true);
    act(() => preferences.set('ui.other', '0'));
    expect(result.current[0]).toBe(true);
    act(() => preferences.delete('ui.lane'));
    expect(result.current[0]).toBe(false);
  });

  it('re-reads when the key changes', () => {
    const { wrapper } = setup({ 'ui.lane.editor': '1', 'ui.lane.panel': '0' });
    const { result, rerender } = renderHook(
      ({ place }: { place: string }) => usePersistentToggle(`lane.${place}`, false),
      { wrapper, initialProps: { place: 'editor' } },
    );
    expect(result.current[0]).toBe(true);
    rerender({ place: 'panel' });
    expect(result.current[0]).toBe(false);
  });
});
