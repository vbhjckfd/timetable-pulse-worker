# timetable-pulse-worker

Cloudflare Worker that acts as a real-time WebSocket broadcast hub for public-transport vehicle positions, used by [lad.lviv.ua](https://lad.lviv.ua).

## How it works

- Vehicles (or a backend service) `POST /signal` with a `{ lat, lng, name }` payload.
- Browser clients connect via `GET /ws` and receive every position update as a JSON message.
- A single [Durable Object](https://developers.cloudflare.com/durable-objects/) (`PulseRoom`) holds all open WebSocket connections and fans out incoming signals.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/ws` | — | WebSocket upgrade; streams position updates |
| `POST` | `/signal` | `Authorization: Bearer <secret>` | Broadcast a vehicle position |

### Signal payload

```json
{ "lat": 49.84, "lng": 24.03, "code": 707 }
```

`lat` and `lng` are required and must fall within the Lviv oblast bounding box. `code` (numeric stop code printed on physical stop signage) is optional.

### Message received by clients

```json
{ "lat": 49.84, "lng": 24.03, "code": 707, "ts": 1715000000000 }
```

## Environment variables / secrets

| Name | Required | Description |
|------|----------|-------------|
| `PULSE_SIGNAL_SECRET` | Yes (prod) | Bearer token that protects `POST /signal` |

Set it as a [Worker secret](https://developers.cloudflare.com/workers/configuration/secrets/):

```sh
wrangler secret put PULSE_SIGNAL_SECRET
```

## Development

```sh
npm install
npm run dev        # wrangler dev — local Worker with hot reload
```

## Deployment

```sh
npm run deploy     # wrangler deploy
```

CI deploys automatically on every push to `main` via GitHub Actions (requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets).
