# Foundry Relay Security Model

The Foundry face uses the proxy as the trust boundary. VQ units remain behind
the proxy and receive only bounded, validated data.

## Server-side secrets

- `VQ_CLUSTER_TOKEN` authenticates proxy-to-VQ unit connections and is never
  sent to a Foundry client.
- `OPTIMIZER_GATEWAY_TOKEN` authenticates the relay transport when configured.
  It is separate from the VQ credential.
- `FOUNDRY_GM_TOKEN` authenticates GM control assertions at the proxy. The
  client sends only an assertion value; the server compares it and records a
  bounded GM identifier.

## Relay controls

- Each client receives an opaque, `HttpOnly`, `SameSite=Strict` cookie ID. A
  request-body client ID is ignored.
- Requests are rate-limited per opaque client ID. VQ calls time out at the
  relay boundary.
- Plans must use the current protocol, contain at most 24 actions, expire in
  at most 30 seconds, and use the shared action allow-list and numeric bounds.
- The relay generates the plan ID. Applying a plan requires GM authentication,
  consumes that plan ID once, and checks the original scope and action count.
- GM apply events record only timestamp, GM ID, opaque client ID, plan ID,
  scope, and action count.
- Telemetry is reduced to the documented performance schema. Chat, document,
  raw content, paths, and unknown fields are not forwarded or logged.
- No relay route accepts arbitrary code, command text, setting paths, or
  executable plan fields.

The relay's apply route authorizes and audits the operation; the Foundry action
host remains responsible for applying the already-validated data actions.
