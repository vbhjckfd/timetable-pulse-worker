export { PulseRoom } from './PulseRoom.js';

import { recordEvent } from './newrelic.js';

// Also the allowlist for /ws upgrades, which have no CORS preflight to lean on.
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

      // /signal is the API's own producer: one authenticated caller, sustained
      // well above any per-IP ceiling worth setting. It carries a bearer secret
      // instead, and is deliberately kept out of the rate limiter below — an
      // IP-keyed bucket there would throttle production traffic, not abuse.
      if (url.pathname === '/signal' && request.method === 'POST') {
        const expected = env.PULSE_SIGNAL_SECRET;
        const auth = request.headers.get('Authorization') ?? '';
        if (!expected || auth !== `Bearer ${expected}`) {
          return report(new Response('Unauthorized', { status: 401 }));
        }
      } else {
        // Everything else is unauthenticated and public. Keyed on
        // CF-Connecting-IP, which the edge overwrites, so a client cannot mint
        // a fresh bucket by forging a header.
        const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
        const { success } = await env.RATE_LIMITER.limit({ key: ip });
        if (!success) {
          return report(withCors(request, new Response('Too many requests', { status: 429 })));
        }
      }

      // CORS does not gate WebSockets — browsers send no preflight for an
      // upgrade, and withCors' fallback to ALLOWED_ORIGINS[0] would hand an
      // unknown caller a valid-looking response. The upgrade has to be checked
      // directly. Only browsers consume this feed, so a missing Origin is a
      // non-browser client and is refused with everything else.
      if (url.pathname === '/ws') {
        const origin = request.headers.get('Origin') ?? '';
        if (!ALLOWED_ORIGINS.includes(origin)) {
          return report(new Response('Forbidden origin', { status: 403 }));
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
