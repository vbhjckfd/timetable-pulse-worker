export class PulseRoom {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/signal" && request.method === "POST") {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return new Response("Bad JSON", { status: 400 });
      }

      const { lat, lng, code } = payload;
      if (typeof lat !== "number" || typeof lng !== "number") {
        return new Response("lat and lng required", { status: 422 });
      }
      // Reject coordinates outside Lviv oblast bounding box
      if (lat < 49.6 || lat > 50.2 || lng < 23.4 || lng > 24.8) {
        return new Response("coordinates out of range", { status: 422 });
      }

      const message = JSON.stringify({
        lat,
        lng,
        code: code ?? null,
        ts: Date.now(),
      });
      let delivered = 0;
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(message);
          delivered += 1;
        } catch (_) {}
      }

      // Fan-out size, read back by the entry worker and reported to New Relic.
      // The room is the only place that knows it; a signal delivered to zero
      // sockets is the interesting case (nobody is watching the map).
      return new Response("ok", {
        status: 200,
        headers: { "X-Pulse-Subscribers": String(delivered) },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  webSocketMessage() {}

  webSocketClose() {}
}
