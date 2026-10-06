# Storage-health Capacity Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

The capacity-drift turbo samples bounded storage occupancy reports and
identifies sustained or observed capacity pressure. It is observation-only:
it does not delete files, organize paths, remount volumes, or write to disk.

It validates the trigger, sample window, minimum evidence, pressure threshold,
and clock. Its output is immutable and exposes recommendations only.
