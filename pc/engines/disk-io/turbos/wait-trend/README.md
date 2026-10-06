# Disk-I/O Wait Trend Turbo

Status: implementation complete locally; pending Odinn sign-off.

The wait-trend turbo compares adjacent bounded I/O-wait observations and
identifies persistent increase. It never changes queues, services, mounts,
files, or transport state.

Its dedicated library validates reports, applies safety precedence, and
derives environment-aware observation plans without importing the turbo.
