/**
 * New Relic custom-event reporting over the raw Event API.
 *
 * The New Relic Node APM agent cannot run in a Worker — it is CommonJS, spawns
 * background harvest timers and reads Node internals none of which exist in a
 * V8 isolate.  So this posts custom events directly over HTTP instead, the same
 * shape as the Sentry-without-SDK reporting in the sibling gtfs-eta worker.
 *
 * Events land in NRDB as their own eventType and are queryable by NRQL, e.g.
 *   SELECT count(*) FROM PulseWorkerRequest FACET path, status SINCE 1 hour ago
 *
 * Required secret (set via `wrangler secret put NEW_RELIC_LICENSE_KEY`):
 *   NEW_RELIC_LICENSE_KEY — the 40-char ingest licence key (starts eu01xx for
 *   this account), NOT an NRAK-... user API key.  Without it reporting is off,
 *   mirroring how SENTRY_DSN gates Sentry elsewhere in this stack.
 */

// The account is in New Relic's EU region, so ingest must go to the EU
// collector — the US host silently rejects EU licence keys.
const EVENT_API_HOST = "https://insights-collector.eu01.nr-data.net";

const ACCOUNT_ID = "3352365";

/**
 * POST one custom event.  Never throws and never rejects: telemetry must not be
 * able to fail a request.  Call it through ctx.waitUntil so the POST finishes
 * after the response is already on its way to the client.
 */
export async function recordEvent(env, eventType, attributes) {
  const key = env.NEW_RELIC_LICENSE_KEY ?? "";
  if (!key) return;

  const accountId = env.NEW_RELIC_ACCOUNT_ID ?? ACCOUNT_ID;
  const url = `${EVENT_API_HOST}/v1/accounts/${accountId}/events`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Api-Key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ eventType, ...attributes }]),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.status >= 300) {
      console.error(`[newrelic] event POST failed: HTTP ${resp.status}`);
    }
  } catch (exc) {
    console.error(`[newrelic] failed to record ${eventType}: ${exc}`);
  }
}
