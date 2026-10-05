# GPU Utilization Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine aggregates bounded GPU utilization, temperature, VRAM, and model
observations. It distinguishes no-GPU hosts from unknown measurements and
reports separate headless-service and interactive-foreground protection
states.

It is analysis-only. It does not change GPU policy or drivers, access files,
or open transport.

The dedicated `library.js` aggregates bounded GPU observations, compares
snapshots, and emits immutable local review envelopes without applying policy.

The completed turbo/library families are:

- `utilization-burst`: detects sustained and isolated multi-GPU utilization
  bursts.
- `thermal-margin`: measures critical and elevated thermal headroom across
  adapters.
- `vram-pressure`: evaluates per-GPU VRAM usage against reported capacity,
  including explicit no-VRAM posture.
- `multi-gpu-skew`: detects utilization imbalance while preserving valid
  single-GPU and no-GPU states.

All eight turbo/library implementation files are analysis-only, lazy at the
call boundary, trigger-gated, bounded below 500 LOC, and independent of HTTP,
REST, sockets, and turbo-library imports. The family regression is 8 suites,
40 tests, with 100% statements, branches, functions, and lines.
