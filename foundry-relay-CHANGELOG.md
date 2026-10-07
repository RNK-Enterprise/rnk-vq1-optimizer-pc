# Foundry Relay Changelog

## 2026-10-07

- Added server-side relay security enforcement for the Foundry VQ boundary.
- Added opaque client identities, bounded telemetry redaction, protocol and action validation, numeric bounds, plan expiry, request limits, VQ timeouts, replay-safe plan IDs, and bounded GM audit records.
- Added GM-authenticated plan, cleanup recommendation, and apply control routes.
- Kept VQ cluster credentials and GM authentication secrets on the proxy server; clients receive neither secret.
- Added the GM Hub apply authorization handshake.

This Foundry module remains pending Odinn sign-off and release certification.
