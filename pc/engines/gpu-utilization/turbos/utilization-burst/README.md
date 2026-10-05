# GPU Utilization-Burst Turbo and Library

Status: implementation complete locally; pending Odinn sign-off.

This turbo measures bounded maximum GPU utilization across observations. It
distinguishes sustained bursts, isolated bursts, normal utilization, missing
GPU observations, and invalid sensor evidence without recommending a write.

It is analysis-only. It does not change GPU policy, drivers, clocks, fan
controls, user files, or settings; it does not open sockets or use HTTP, REST,
or API transport. It is trigger-gated and keeps its sample window bounded.

Its future mesh endpoint is a separate integration step.

The dedicated library validates utilization-burst reports, merges bounded
counts, and builds environment-aware observation plans and immutable local
envelopes. It does not import the turbo or change GPU policy.
