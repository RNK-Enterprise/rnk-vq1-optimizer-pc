# CPU Scheduler Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies normalized CPU workload as normal, busy, saturated, or
unknown and compares the observed governor with balanced, latency-sensitive,
or throughput profiles. It reports review guidance for documented governor
controls without applying any scheduler or frequency change.

It is analysis-only and does not access files, alter settings, or open
transport.

The dedicated library at `library.js` provides run-queue/context-switch
classification, deltas, sampling guidance, and immutable local envelopes.

The four implemented turbo analyses are `run-queue-burst`, `context-churn`,
`queue-utilization-mismatch`, and `governor-transitions`. Each turbo has its
own implementation and dedicated library with tests, README, and changelog.
The eight turbo/library files pass the family regression at
100/100/100/100/100/100. Mesh wiring, automatic execution, and Odinn sign-off
remain pending.
