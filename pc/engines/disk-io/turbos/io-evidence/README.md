# Disk-I/O Evidence Turbo

Status: implementation complete locally; pending Odinn sign-off.

The I/O-evidence turbo scores whether read, write, and wait facts are present
for bounded disk rows. It never probes devices, changes queues, services,
mounts, or files.

Its dedicated library validates reports, applies safety precedence, and
derives environment-aware observation plans without importing the turbo.
