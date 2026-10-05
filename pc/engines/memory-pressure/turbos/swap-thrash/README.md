# Memory Pressure Swap Thrash Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo classifies bounded swap utilization, swap-in and swap-out activity,
memory pressure context, rising swap use, reclaim churn, and oscillation. It
preserves missing and invalid sensor evidence as distinct outcomes.

The turbo is analysis-only. It does not reclaim memory, change swap policy,
touch user files, alter settings, open sockets, or use HTTP, REST, or API
transport. It fires only on system-facts, workload, and health triggers and
keeps all windows and thresholds bounded.

Its future mesh endpoint is a separate integration step.

The dedicated library validates and aggregates only swap-thrash reports, builds
environment-specific observation plans, and emits immutable local envelopes.
It does not import the turbo or the engine library.
