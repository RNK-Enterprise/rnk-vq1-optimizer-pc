# Memory Policy Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine evaluates whether normalized RAM and swap evidence supports the
documented balanced or background-low policy choices. High pressure holds the
current policy and destructive actions; unknown environments and observations
remain profile-required or observation-required.

It is analysis-only. It never changes memory policy, reclaims memory, clears
caches, accesses files, or opens transport.

The dedicated `library.js` classifies policy posture, compares RAM and swap
snapshots, and emits immutable local review envelopes without applying policy.

The completed turbo/library families are:

- `pressure-policy-drift`: classifies policy escalation, recovery, churn, and
  stable posture, then validates and plans those reports.
- `consent-boundary`: detects missing consent and blocked destructive requests,
  then keeps review and envelope handling separate from approval.
- `headless-posture`: compares observed policy with environment posture, then
  aggregates headless and interactive protection gaps.
- `swap-policy-alignment`: compares swap pressure with observed policy, then
  aggregates critical gaps and missing evidence conservatively.

All eight turbo/library implementation files are analysis-only, lazy at the
call boundary, trigger-gated, bounded below 500 LOC, and independent of HTTP,
REST, sockets, and turbo-library imports. The family regression is 8 suites,
40 tests, with 100% statements, branches, functions, and lines.
