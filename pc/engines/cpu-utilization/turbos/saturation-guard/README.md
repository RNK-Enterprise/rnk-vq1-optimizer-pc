# CPU Utilization Saturation-Guard Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo uses a bounded consecutive-run algorithm to classify clear,
intermittent, sustained, and recovering CPU saturation. Missing samples reset
runs and remain explicit observation gaps. It is analysis-only and emits no
actions or policy changes.

Its dedicated library is `library.js`. The library validates turbo reports,
merges saturation runs and recovery transitions, builds environment-aware
observation plans, and remains independent of the turbo implementation.
