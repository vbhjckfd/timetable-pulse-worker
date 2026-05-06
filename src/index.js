export { PulseRoom } from './PulseRoom.js';

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
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(request, new Response(null, { status: 204 }));
    }

    if (url.pathname === '/signal' && request.method === 'POST') {
      const expected = env.PULSE_SIGNAL_SECRET;
      const auth = request.headers.get('Authorization') ?? '';
      if (!expected || auth !== `Bearer ${expected}`) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    if (url.pathname === '/ws' || url.pathname === '/signal') {
      const id = env.PULSE_ROOM.idFromName('global');
      const stub = env.PULSE_ROOM.get(id);
      const response = await stub.fetch(request);
      // WebSocket upgrade responses must not have CORS headers modified
      if (response.status === 101) {
        return response;
      }
      return withCors(request, response);
    }

    return withCors(request, new Response('Not found', { status: 404 }));
  },
};
