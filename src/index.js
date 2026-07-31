export { PulseRoom } from './PulseRoom.js';

import { recordEvent } from './newrelic.js';

const ALLOWED_ORIGINS = [
  'https://lad.lviv.ua',
  'http://localhost:3000',
  'http://localhost:3001',
];

function withCors(request, response) {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', allowed);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, { status: response.status, webSocket: response.webSocket, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const started = Date.now();

    // One event per invocation, reported after the response is handed back so
    // the ingest POST never sits in the request's critical path. `subscribers`
    // is only present on /signal, where PulseRoom reports its fan-out size.
    const report = (response) => {
      const subscribers = response.headers.get('X-Pulse-Subscribers');
      ctx.waitUntil(recordEvent(env, 'PulseWorkerRequest', {
        path: url.pathname,
        method: request.method,
        status: response.status,
        durationMs: Date.now() - started,
        colo: request.cf?.colo ?? null,
        country: request.cf?.country ?? null,
        ...(subscribers === null ? {} : { subscribers: Number(subscribers) }),
      }));
      return response;
    };

    try {
      if (request.method === 'OPTIONS') {
        return report(withCors(request, new Response(null, { status: 204 })));
      }

      if (url.pathname === '/signal' && request.method === 'POST') {
        const expected = env.PULSE_SIGNAL_SECRET;
        const auth = request.headers.get('Authorization') ?? '';
        if (!expected || auth !== `Bearer ${expected}`) {
          return report(new Response('Unauthorized', { status: 401 }));
        }
      }

      if (url.pathname === '/ws' || url.pathname === '/signal') {
        const id = env.PULSE_ROOM.idFromName('global');
        const stub = env.PULSE_ROOM.get(id);
        const response = await stub.fetch(request);
        // WebSocket upgrade responses must not have CORS headers modified
        if (response.status === 101) {
          return report(response);
        }
        return report(withCors(request, response));
      }

      return report(withCors(request, new Response('Not found', { status: 404 })));
    } catch (exc) {
      // Record, then rethrow so the runtime's own 500 and error logging are
      // unchanged — this handler exists only to observe, not to swallow.
      ctx.waitUntil(recordEvent(env, 'PulseWorkerRequest', {
        path: url.pathname,
        method: request.method,
        status: 500,
        durationMs: Date.now() - started,
        error: true,
        errorMessage: String(exc?.message ?? exc),
      }));
      throw exc;
    }
  },
};
