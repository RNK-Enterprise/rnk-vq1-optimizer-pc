# GPU Multi-GPU-Skew Turbo and Library

Status: implementation complete locally; pending Odinn sign-off.

This turbo compares bounded utilization across GPU adapters and identifies
sustained skew, isolated skew, balanced layout, no-GPU hardware, missing
observations, and invalid sensor evidence without recommending a write.

It is analysis-only. It does not change GPU policy, drivers, clocks, fan
controls, user files, or settings; it does not open sockets or use HTTP, REST,
or API transport. It is trigger-gated and keeps its sample window bounded.

Its future mesh endpoint is a separate integration step.

The dedicated library validates multi-GPU skew reports, merges bounded counts,
and builds environment-aware observation plans and immutable local envelopes.
It does not import the turbo or change GPU policy.
