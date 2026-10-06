# Storage-health Read-only Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

The read-only-drift turbo samples bounded boolean read-only evidence and
identifies sustained elevated read-only ratios. Missing evidence is reported
as incomplete; the turbo never remounts volumes, changes permissions, or
writes files.

Its dedicated library validates reports, applies safety precedence, and
derives environment-aware observation plans without importing the turbo.
