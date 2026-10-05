# Swap Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine distinguishes no-swap, normal, elevated, high, and unknown swap
evidence. No-swap hosts remain an explicit user-owned state; high pressure
holds destructive actions and requests review of memory pressure.

It is analysis-only. It does not create swap, change swappiness, access files,
or open transport.

The dedicated `library.js` classifies swap availability and pressure, compares
snapshots, and emits immutable local review envelopes without changing swap.

The completed turbo/library families are:

- `pressure-dwell`: measures sustained high or elevated swap pressure.
- `headroom-collapse`: tracks free-swap headroom collapse and recovery while
  preserving no-swap ownership.
- `availability-drift`: detects swap availability transitions and capacity
  loss or gain.
- `accounting-consistency`: compares total/free accounting with reported swap
  utilization and fails closed on sensor disagreement.

All eight turbo/library implementation files are analysis-only, lazy at the
call boundary, trigger-gated, bounded below 500 LOC, and independent of HTTP,
REST, sockets, and turbo-library imports. The family regression is 8 suites,
40 tests, with 100% statements, branches, functions, and lines.
