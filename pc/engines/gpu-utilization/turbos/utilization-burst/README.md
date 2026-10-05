# GPU Utilization-Burst Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo measures bounded maximum GPU utilization across observations. It
distinguishes sustained bursts, isolated bursts, normal utilization, missing
GPU observations, and invalid sensor evidence without recommending a write.

It is analysis-only. It does not change GPU policy, drivers, clocks, fan
controls, user files, or settings; it does not open sockets or use HTTP, REST,
or API transport. It is trigger-gated and keeps its sample window bounded.

Its future mesh endpoint is a separate integration step.
