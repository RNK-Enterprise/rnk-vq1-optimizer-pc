# GPU VRAM-Pressure Turbo and Library

Status: implementation complete locally; pending Odinn sign-off.

This turbo measures bounded per-GPU VRAM usage against reported capacity. It
distinguishes sustained critical and elevated pressure, normal pressure,
no-VRAM hardware, missing observations, and invalid capacity evidence without
recommending a write.

It is analysis-only. It does not change GPU policy, drivers, clocks, fan
controls, user files, or settings; it does not open sockets or use HTTP, REST,
or API transport. It is trigger-gated and keeps its sample window bounded.

Its future mesh endpoint is a separate integration step.

The dedicated library validates VRAM-pressure reports, merges bounded counts,
and builds environment-aware observation plans and immutable local envelopes.
It does not import the turbo or change GPU policy.
