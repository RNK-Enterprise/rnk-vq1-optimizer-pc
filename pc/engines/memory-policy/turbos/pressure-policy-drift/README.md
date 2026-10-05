# Memory Policy Pressure-Policy Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo classifies bounded memory-pressure and recommended-policy
transitions as stable, escalating, recovering, or churning. Unknown and
out-of-range evidence remain explicit refusal states.

The turbo is analysis-only. It does not change memory policy, reclaim memory,
clear caches, touch user files, alter settings, open sockets, or use HTTP,
REST, or API transport. It fires only on system-facts, workload, and health
triggers and keeps its sample window bounded.

Its future mesh endpoint is a separate integration step.
