# Disk-I/O Wait Burst Turbo

Status: implementation complete locally; pending Odinn sign-off.

The wait-burst turbo samples bounded I/O wait pressure and identifies
persistent contention. It never changes queues, services, mounts, files, or
transport state.

Its dedicated library validates reports, applies safety precedence, and
derives environment-aware observation plans without importing the turbo.
