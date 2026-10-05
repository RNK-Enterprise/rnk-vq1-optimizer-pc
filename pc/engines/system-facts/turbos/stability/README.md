# Stability Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo evaluates volatility across a bounded sequence of normalized
system-facts snapshots. It calculates dimension-level volatility, directional
trend, confidence-weighted stability, and a bounded state of `stable`, `watch`,
or `unstable`.

It is analysis-only. It does not apply operating-system actions, access user
files, open a mesh connection, or delegate its algorithm to an engine library.
