# GPU Driver-Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo compares bounded GPU driver evidence across snapshots. It
distinguishes documented stability, driver drift, vendor-specific evidence,
incomplete evidence, no-GPU posture, and missing observations without treating
unknown data as permission for a driver or policy change.

It is analysis-only. It does not install or change drivers, alter GPU policy,
touch user files or settings, open sockets, or use HTTP, REST, or API
transport. It is trigger-gated and keeps its sample window bounded.

Its future mesh endpoint is a separate integration step.
