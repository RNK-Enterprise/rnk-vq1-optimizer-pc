# Memory Pressure Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies normalized RAM usage as normal, elevated, high, or
unknown. It reports memory headroom, swap pressure, confidence, and separate
headless-service or interactive-foreground protection guidance.

It is analysis-only. It does not reclaim memory, clear caches, access user
files, alter settings, or open transport.

The dedicated `library.js` classifies bounded RAM and swap evidence, compares
snapshots, and emits immutable local trigger envelopes without applying policy.
