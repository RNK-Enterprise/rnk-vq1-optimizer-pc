# Disk-I/O Throughput Skew Turbo

Status: implementation complete locally; pending Odinn sign-off.

The throughput-skew turbo compares bounded read and write rates per disk and
identifies persistent imbalance. It never reprioritizes queues, changes
services, remounts storage, or writes files.

Its dedicated library validates reports, applies safety precedence, and
derives environment-aware observation plans without importing the turbo.
