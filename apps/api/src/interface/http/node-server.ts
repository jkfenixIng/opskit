import { serve } from '@hono/node-server';

export type FetchHandler = (request: Request) => Response | Promise<Response>;
export type RunningServer = { close(onClosed: () => void): void };

/** Binds a fetch handler to a Node HTTP listener. Idle keep-alive sockets are released on close. */
export function listen(fetch: FetchHandler, options: { hostname: string; port: number }, onListening: (url: string) => void): RunningServer {
  const server = serve({ fetch, hostname: options.hostname, port: options.port }, ({ address, port }) => onListening(`http://${address}:${port}`));
  return {
    close(onClosed) {
      server.close(() => onClosed());
      if ('closeIdleConnections' in server) server.closeIdleConnections();
    },
  };
}
