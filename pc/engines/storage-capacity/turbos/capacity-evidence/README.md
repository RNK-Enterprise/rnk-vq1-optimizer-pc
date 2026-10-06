# Storage-capacity Capacity Evidence Turbo

Status: implementation complete locally; pending Odinn sign-off.

The capacity-evidence turbo scores whether bounded storage rows include mount,
total-byte, and free-byte facts. It requests better observation when evidence
is incomplete and never probes, mounts, organizes, or writes.

Its dedicated library validates reports, applies safety precedence, and
derives environment-aware observation plans without importing the turbo.
