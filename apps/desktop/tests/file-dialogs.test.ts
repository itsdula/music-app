import { describe, expect, it, vi } from 'vitest';
import { createElectronFileDialogs } from '../src/renderer/file-dialogs';
import type { StudioHostApi } from '../src/shared/host-api';

function fakeHost(): Pick<StudioHostApi, 'openFiles' | 'saveFile'> {
  return {
    openFiles: vi.fn((_accept: string[], _multiple: boolean) =>
      Promise.resolve([{ name: 'a.wav', mimeType: 'audio/wav', bytes: new Uint8Array([1]) }]),
    ),
    saveFile: vi.fn(() => Promise.resolve(true)),
  };
}

describe('createElectronFileDialogs', () => {
  it('forwards openFiles options as a mutable copy and maps results', async () => {
    const host = fakeHost();
    const accept = Object.freeze(['audio/*', '.wav']);
    const files = await createElectronFileDialogs(host).openFiles({ accept, multiple: true });
    expect(host.openFiles).toHaveBeenCalledWith(['audio/*', '.wav'], true);
    expect(vi.mocked(host.openFiles).mock.calls[0]![0]).not.toBe(accept);
    expect(files).toEqual([{ name: 'a.wav', mimeType: 'audio/wav', bytes: new Uint8Array([1]) }]);
  });

  it('forwards saveFile as positional arguments', async () => {
    const host = fakeHost();
    const bytes = new Uint8Array([9, 9]);
    const saved = await createElectronFileDialogs(host).saveFile(bytes, {
      suggestedName: 'mix.wav',
      mimeType: 'audio/wav',
    });
    expect(saved).toBe(true);
    expect(host.saveFile).toHaveBeenCalledWith(bytes, 'mix.wav', 'audio/wav');
  });

  it('propagates cancellation and errors', async () => {
    const host = fakeHost();
    vi.mocked(host.saveFile).mockResolvedValueOnce(false);
    vi.mocked(host.openFiles).mockRejectedValueOnce(new Error('denied'));
    const dialogs = createElectronFileDialogs(host);
    await expect(
      dialogs.saveFile(new Uint8Array(), { suggestedName: 'a', mimeType: 'a/b' }),
    ).resolves.toBe(false);
    await expect(dialogs.openFiles({ accept: [], multiple: false })).rejects.toThrow('denied');
  });
});
