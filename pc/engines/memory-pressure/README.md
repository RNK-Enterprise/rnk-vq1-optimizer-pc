# Memory Pressure Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies normalized RAM usage as normal, elevated, high, or
unknown. It reports memory headroom, swap pressure, confidence, and separate
headless-service or interactive-foreground protection guidance.

It is analysis-only. It does not reclaim memory, clear caches, access user
files, alter settings, or open transport.

The dedicated `library.js` classifies bounded RAM and swap evidence, compares
snapshots, and emits immutable local trigger envelopes without applying policy.

The four implemented turbo analyses are `used-trend`, `swap-thrash`,
`headroom-volatility`, and `oom-margin`. Each has its own implementation and
dedicated library with tests, README, and changelog. The eight turbo/library
files pass the family regression with 8 suites and 40 tests at
100/100/100/100/100/100. Mesh wiring, automatic execution, and Odinn sign-off
remain separate steps.
