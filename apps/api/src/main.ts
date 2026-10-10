import { loadRuntimeConfig } from '@opskit/config';
import { composeApi } from './composition/factory.js';
import { listen } from './interface/http/node-server.js';

const config = loadRuntimeConfig();
const api = composeApi(config);
const server = listen(api.fetch, { hostname: config.API_HOST, port: config.API_PORT }, (url) => console.log(`API listening on ${url}`));

let stopping = false;
function shutdown(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, closing API`);
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => { api.close(); process.exit(0); });
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
