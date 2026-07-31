# timetable-pulse-worker

Cloudflare Worker that acts as a real-time WebSocket broadcast hub for public-transport stop arrival timetable queries, used by [lad.lviv.ua](https://lad.lviv.ua).

## How it works

- A client `POST /signal` with a `{ lat, lng, code }` payload representing a stop being queried for arrival times.
- Browser clients connect via `GET /ws` and receive every stop query as a JSON message.
- A single [Durable Object](https://developers.cloudflare.com/durable-objects/) (`PulseRoom`) holds all open WebSocket connections and fans out incoming signals.

## Endpoints

| Method | Path      | Auth                             | Description                                       |
| ------ | --------- | -------------------------------- | ------------------------------------------------- |
| `GET`  | `/ws`     | —                                | WebSocket upgrade; streams stop timetable queries |
| `POST` | `/signal` | `Authorization: Bearer <secret>` | Broadcast a stop arrival timetable query          |

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

| Name                    | Required   | Description                                             |
| ----------------------- | ---------- | ------------------------------------------------------- |
| `PULSE_SIGNAL_SECRET`   | Yes (prod) | Bearer token that protects `POST /signal`               |
| `NEW_RELIC_LICENSE_KEY` | No         | Enables New Relic reporting; absent = reporting is off  |
| `NEW_RELIC_ACCOUNT_ID`  | No         | Plain var in `wrangler.toml`, defaults to the EU account |

Set the secrets as [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/):

```sh
wrangler secret put PULSE_SIGNAL_SECRET
```

```sh
wrangler secret put NEW_RELIC_LICENSE_KEY
```

## Monitoring

The New Relic Node APM agent cannot run in a Worker — it is CommonJS, spawns
background harvest timers and reads Node internals that a V8 isolate does not
have. So [src/newrelic.js](src/newrelic.js) posts custom events straight to the
Event API over `fetch`, with no dependency and nothing added to the bundle.

One `PulseWorkerRequest` event per invocation, sent via `ctx.waitUntil` so
ingest never sits in the request path: `path`, `method`, `status`,
`durationMs`, `colo`, `country`, and — on `POST /signal` — `subscribers`, the
number of sockets the room actually delivered to. A signal that fans out to
zero subscribers means nobody is watching the map.

```sql
SELECT count(*) FROM PulseWorkerRequest FACET path, status SINCE 1 hour ago
SELECT average(subscribers) FROM PulseWorkerRequest WHERE path = '/signal' TIMESERIES
```

The account is in New Relic's **EU** region: ingest goes to
`insights-collector.eu01.nr-data.net` and the key is the 40-character licence
key starting `eu01xx`, not an `NRAK-...` user API key.

## Development

```sh
npm install
npm run dev        # wrangler dev — local Worker with hot reload
```

## Deployment

```sh
npm run deploy     # wrangler deploy
```

CI deploys automatically on every push to `master` via GitHub Actions (requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets).
