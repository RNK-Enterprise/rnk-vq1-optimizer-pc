# CPU Frequency Residency Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo classifies bounded CPU frequency residency against the observed
base or maximum frequency. It identifies low residency during high utilization,
sustained boost residency, unstable band changes, invalid sensor ranges, and
insufficient evidence.

The turbo is analysis-only. It does not change frequency policy, write files,
invoke operating-system controls, open sockets, or use HTTP, REST, or API
transport. It fires only on the documented system-facts, workload, and health
triggers and keeps its sample window bounded.

The implementation and its tests are local to this turbo module. Its future
mesh endpoint remains a separate integration step.

The dedicated library validates and aggregates only frequency-residency
reports, builds environment-specific observation plans, and emits immutable
local envelopes. It does not import the turbo or the engine library.
