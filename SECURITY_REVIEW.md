# Security Review — LISA Proxy, Optimizer Gateway, Entry Point

**Scope:** `lisa-secure-proxy.js`, `optimizer-gateway.js`, `start-proxy.mjs`,
`scripts/foundry-action-host.js` (consumer of gateway plans).
**Method:** full-file read, threat model, live proof-of-concept attacks
against a running proxy + mock VQ unit on localhost, then fix verification
with a second PoC round. All PoCs ran in-process on 127.0.0.x; nothing was
scanned remotely.

Every finding below was **reproduced live first**, then fixed, then
**re-verified live against the fix**. This is not a static checklist.

## Findings

### F1 — WebSocket clients had no authentication (HIGH) — FIXED
`handleClient` accepted any upgrade; a client token option did not exist.
Any process that could reach the proxy port could drive the whole VQ
cluster. **Fix:** optional shared-token auth
(`LISA_PROXY_CLIENT_TOKEN` env or `clientToken` option), enforced before
any cluster information is sent, compared timing-safely (SHA-256 both
sides + `timingSafeEqual`). Verified: unauthenticated upgrade closed with
1008; token-carrying upgrade accepted.

### F2 — Gateway shipped unauthenticated by default (HIGH) — FIXED
`start-proxy.mjs` never required `OPTIMIZER_GATEWAY_TOKEN`, and
`attachOptimizerGateway` compared tokens with `===` (string compare, not
constant-time). Live PoC: unauthenticated `POST /optimizer/v1/plan`
returned 200 and dispatched into the cluster. **Fix:** entry point now
refuses to start unless both `VQ_CLUSTER_TOKEN` and
`OPTIMIZER_GATEWAY_TOKEN` are set (verified exit=1 without, OK with);
gateway auth now uses the same timing-safe compare. Verified: 401 without
token, 200 with.

### F3 — Unbounded client frames (HIGH) — FIXED
The WS path had no size cap; a single 2 MB frame was parsed and forwarded
to the cluster (the HTTP path capped at 128 KB, the WS path did not).
**Fix:** `MAX_CLIENT_FRAME_BYTES` (128 KB, matching the HTTP body cap)
enforced before parse; violations get close code 1009 and are dropped.
Verified live: 2 MB frame → close 1009, nothing dispatched.

### F4 — Topology disclosure (MEDIUM) — FIXED
The WS hello and `clusterStatus()` included unit `host:port` endpoints,
defeating the "no IP addresses exposed to clients" claim in this file's
own header. **Fix:** endpoints removed from both; clients learn unit ids
and health only. Verified live: hello contains no endpoint/host/port.

### F5 — Attacker-controlled `requestId` echo (MEDIUM) — FIXED
Client-supplied `requestId` reached the units verbatim and was echoed
into responses — a response-injection/confusion primitive (e.g. ids
shaped like other clients', control chars, 500-char junk). **Fix:**
`safeRequestId()` enforces type, ≤128 chars, strict charset
(`[A-Za-z0-9._:-]`), mints a server id otherwise; applied on every
dispatch path and status echo. Verified live: hostile id not echoed.

### F6 — Dispatch amplification (MEDIUM) — FIXED
No cap on concurrent cluster dispatches; WS clients could stack
unbounded in-flight requests. **Fix:** `MAX_ACTIVE_DISPATCHES` (64)
fails closed with a busy error. (Existing 6s request timeouts bound
per-request hangs; the cap bounds total amplification.)

### F7 — Internal error detail leaked to clients (LOW) — FIXED
Dispatch failures echoed raw `error.message` (unit ids, timeouts) to the
client. **Fix:** fixed non-committal client message; detail stays in the
server log.

## Residual risks (documented, not fixed here)

- **Loopback trust:** the proxy binds all interfaces by default and
  authorizes with shared tokens. On a multi-user host, any local process
  that obtains the tokens can drive the cluster. Binding explicitly to
  `127.0.0.1` (where the deployment allows it) is a deployment
  hardening; not enforced in code.
- **DoS-bound in-flight requests:** the busy cap protects the units, but
  slow-frame clients still hold WS connections; consider per-connection
  message rate limiting later.
- **`foundry-action-host.js`:** applies only allow-listed action types
  with bounds enforced upstream (protocol allow-list, gateway validation,
  local re-validation) — consistent with the data-only plan design. No
  code execution path exists; nothing to fix.

## Verification

Round-1 PoC: F1–F5 confirmed vulnerable (F6 partial, F6-robustness OK).
Round-2 PoC after fixes: all five fix checks pass (entry-point refusal,
WS auth, gateway 401/200, close-1009 on oversized frame, hello hygiene,
server-minted request ids). Full unit suite unaffected: 626/626,
coverage gate green.
