# CPU Affinity Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine evaluates physical and logical CPU topology, SMT shape, socket
count, utilization, and affinity risk. It identifies inconsistent or
multi-socket topology before any future affinity review and preserves the
operating-system layout by default.

It is analysis-only. It never pins processes, changes affinity masks, accesses
files, or opens transport.

The dedicated `library.js` normalizes explicit affinity and isolated-CPU lists,
compares snapshots, and emits immutable trigger envelopes for local consumers.
It does not apply masks or make administrative changes.
