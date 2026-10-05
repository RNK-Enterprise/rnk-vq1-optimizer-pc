# GPU Thermal-Margin Turbo and Library

Status: implementation complete locally; pending Odinn sign-off.

This turbo measures multi-GPU thermal margin against a documented thermal
limit. It distinguishes sustained critical and elevated thermal posture,
normal margin, missing observations, and invalid temperature evidence without
recommending a write.

It is analysis-only. It does not change GPU policy, clocks, fan controls,
drivers, user files, or settings; it does not open sockets or use HTTP, REST,
or API transport. It is trigger-gated and keeps its sample window bounded.

Its future mesh endpoint is a separate integration step.

The dedicated library validates thermal-margin reports, merges bounded counts,
and builds environment-aware observation plans and immutable local envelopes.
It does not import the turbo or change GPU policy.
