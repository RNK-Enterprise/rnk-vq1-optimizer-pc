# Storage-capacity Free-space Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

The free-space-drift turbo samples bounded minimum free-space headroom and
identifies sustained pressure. It does not delete, move, organize, remount,
or write files.

Its dedicated library validates reports, applies safety precedence, and
derives environment-aware observation plans without importing the turbo.
