/** Binds a server to the first free port of a range (the monitor prefers 3300). */
import type { Server } from 'node:http';

export class NoFreePortError extends Error {
  constructor(host: string, first: number, last: number) {
    super(`no free port on ${host} between ${first} and ${last}`);
    this.name = 'NoFreePortError';
  }
}

function tryListen(server: Server, port: number, host: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false);
      else reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/** Resolves with the bound port, or rejects with `NoFreePortError`. */
export async function listenOnFreePort(
  server: Server,
  host: string,
  first: number,
  last: number,
): Promise<number> {
  for (let port = first; port <= last; port++) {
    if (await tryListen(server, port, host)) return port;
  }
  throw new NoFreePortError(host, first, last);
}
