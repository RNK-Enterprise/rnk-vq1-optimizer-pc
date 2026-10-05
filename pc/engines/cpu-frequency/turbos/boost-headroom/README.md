# CPU Frequency Boost Headroom Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo compares requested and observed CPU frequency across a bounded
sample window. It identifies thermal-limited shortfall, boost shortfall under
high utilization, variable headroom, satisfied requests, invalid sensor
ranges, and insufficient evidence.

The turbo is analysis-only. It does not change frequency policy, write files,
invoke operating-system controls, open sockets, or use HTTP, REST, or API
transport. It fires only on the documented system-facts, workload, and health
triggers and keeps all thresholds explicit and bounded.

The implementation and its tests are local to this turbo module. Its future
mesh endpoint remains a separate integration step.
