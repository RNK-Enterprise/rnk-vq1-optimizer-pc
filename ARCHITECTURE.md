# RNK Vortex System Optimizer - Tandem Cluster Architecture

## System Overview

VQ-1 and VQ-2 are two independent builds designed to be deployed simultaneously
as one logical cluster. The Optimizer is the Foundry-side brain that discovers
both units, shares the load between them, and survives either unit going down
with zero human configuration.

```
+--------------------+     ws://<foundry-host>/vq-lisa-proxy     +---------------------------+
|  Foundry VTT (GM)  | <---------------------------------------- |  LISA Secure Proxy        |
|  browser client    |                                            |  (Foundry server, private)|
+--------------------+                                            +------------+--------------+
      dual-vq-connector.js                                                     | discovers + dispatches
      vortex-quantum-bridge.js                                   +-------------+-------------+
                                                                 |                           |
                                                          ws://127.0.0.1:3000        ws://127.0.0.1:3001
                                                                 |                           |
                                                          +------v------+             +------v------+
                                                          |    VQ-1     |             |    VQ-2     |
                                                          |  (build 1)  |             |  (build 2)  |
                                                          +-------------+             +-------------+
```

- Clients NEVER see unit addresses. Only the proxy knows where the units live.
- The proxy listens on port 9999 (env `LISA_PROXY_PORT`).
- Foundry must route `/vq-lisa-proxy` to the proxy (see nginx snippet below).

## Zero-Config Discovery

There are no host/port settings to fill in. On startup, and every 15 seconds
after that, the proxy probes the candidate ports `3000` and `3001` on the local
host (`127.0.0.1`) with a TCP connect check:

- Port answers      -> connect, identify as `VQ-1` / `VQ-2`, begin health polling.
- Port closed       -> unit slot stays dark; retried on the next scan.
- Unit starts later -> picked up automatically on a later scan (no restart).
- Unit dies         -> socket close fires, failover happens, reconnect every 5s.

Candidate ports can be overridden for tests or exotic deployments via the
`unitPorts` constructor option or `VQ_UNIT_HOST` for a non-local host, but the
default path requires zero configuration.

## Request Flow (load sharing)

1. Browser module sends a JSON message over the `/vq-lisa-proxy` WebSocket.
2. `lisa.status` / `lisa.cluster.status` are answered locally from cluster state.
3. Everything else is dispatched:
   - One healthy unit -> it gets everything.
   - Two healthy units -> least in-flight requests wins; ties broken by lowest
     measured latency.
4. If the chosen unit errors or times out, the request is retried once on the
   other unit (automatic failover). The client never sees the first failure.

## Health Polling

The proxy polls both units every 5 seconds with `vq.health.ping`. A unit is
HEALTHY only while it answers within the window; two consecutive missed polls
mark it UNHEALTHY and it stops receiving traffic until it answers again.
Connection state, latency and per-unit counters are tracked continuously and
exposed in `lisa.cluster.status`.

## Unit Protocol Contract

What the VQ unit builds must implement to join the cluster:

| Message in            | Meaning                                                      |
| --------------------- | ------------------------------------------------------------ |
| `vq.health.ping`      | Health probe. MUST respond with `{"type":"vq.health","latencyMs":<n>}`. |
| anything else         | Treated as a request; MUST echo the `requestId` field of the request in the response. |

Minimal viable unit (for testing or as the seed of a real build):

```js
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ port: 3000 }); // 3001 for the second unit
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'vq.health.ping') {
      ws.send(JSON.stringify({ type: 'vq.health', latencyMs: 1 }));
      return;
    }
    ws.send(JSON.stringify({ ...msg, requestId: msg.requestId, ok: true }));
  });
});
```

## Browser-Side Bridge

`scripts/vortex-quantum-bridge.js` mirrors the same policy for direct (non-proxy)
integrations: round-robin, parallel (least-loaded with failover, no duplicated
work), or sharded execution across `window.vortexQuantum` / `window.vortexQuantum2`,
with 5s health checks that take offline units out of rotation.

`scripts/dual-vq-connector.js` connects the browser to the proxy endpoint only,
exposes the LISA command interface on `window.LISA`, and degrades gracefully
(dummy offline objects) when the proxy is not running, so the module always works.

## VQ Optimizer Core Integration

The optimizer UI additionally runs the embedded dual-stack core
(`scripts/vq/`, vendored from `Vq Build`) through the Foundry host adapter
(`scripts/vq-foundry-host.js`). The *Run VQ Cycle* button requests a
data-only plan from the VQ server (`vqServerUrl`, default same-origin
`/optimizer/plan`), applies only allow-listed, locally re-validated actions,
persists them per user per world via `game.settings`, and falls back to a
safe local plan when the server is unreachable. See README.md for details.

## Cluster Modes

| Healthy units | Mode             | Behavior                          |
| ------------- | ---------------- | --------------------------------- |
| 2             | `TANDEM`         | Full load sharing + redundancy    |
| 1             | `DEGRADED-SINGLE`| All traffic on the survivor       |
| 0             | `OFFLINE`        | Requests rejected; proxy retries  |

## Running It

```bash
# On the Foundry server (private - never distribute this file):
npm install
node lisa-secure-proxy.js

# Start your two VQ units on ports 3000 and 3001. That is the whole setup.
```

Foundry reverse proxy (so the browser can reach the proxy through Foundry):

```nginx
location /vq-lisa-proxy {
    proxy_pass http://localhost:9999;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

## Test Coverage

`test/tandem-proxy.test.js` covers: port probing, unit connection state,
discovery of only-live ports, least-loaded selection, latency tie-breaking,
failover dispatch, no-unit rejection, mode reporting and failover counting.
Run with `npx jest test/tandem-proxy.test.js`.

## Known Gaps / Next Steps

- VQ unit reference builds (`V1/`, `V2/` in the repo root) are empty; the
  protocol contract above is what they must satisfy.
- Request timeout is conservative (6s); make it per-command configurable.
- ~~No authentication yet between proxy and units~~ RESOLVED: shared-token
  auth is implemented. Set the same `VQ_CLUSTER_TOKEN` on the proxy and every
  unit; units then reject WebSocket upgrades and HTTP requests that do not
  carry the token (`x-vq-token` header, `Authorization: Bearer`, or `?token=`
  query on upgrades), compared timing-safely. Units without a token stay in
  open mode and warn on non-loopback connections. See `vq-cluster-auth.js`
  in each unit stack and `VQ 1/TANDEM_CLUSTER.md`.
- `updateMetrics` in the browser bridge attributes requests to VQ1/VQ2 by
  name-substring; replace with explicit unit ids once the unit builds land.
