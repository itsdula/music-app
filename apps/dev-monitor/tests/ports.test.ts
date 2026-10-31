import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { listenOnFreePort, NoFreePortError } from '../src/ports';

const servers: Server[] = [];
const track = (server: Server) => (servers.push(server), server);

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});

async function freeBase(): Promise<number> {
  const probe = track(createServer());
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  return address.port;
}

describe('listenOnFreePort', () => {
  it('skips ports in use and binds the next free one', async () => {
    const taken = await freeBase(); // held open by the probe server
    const server = track(createServer());
    const port = await listenOnFreePort(server, '127.0.0.1', taken, taken + 20);
    expect(port).toBeGreaterThan(taken);
    expect(server.listening).toBe(true);
  });

  it('binds the first port when it is free', async () => {
    const base = await freeBase();
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()));
    const server = track(createServer());
    expect(await listenOnFreePort(server, '127.0.0.1', base, base)).toBe(base);
  });

  it('fails when the whole range is taken', async () => {
    const taken = await freeBase();
    await expect(
      listenOnFreePort(track(createServer()), '127.0.0.1', taken, taken),
    ).rejects.toBeInstanceOf(NoFreePortError);
  });
});
