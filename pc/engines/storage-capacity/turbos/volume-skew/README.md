# Storage-capacity Volume Skew Turbo

Status: implementation complete locally; pending Odinn sign-off.

The volume-skew turbo compares bounded free-space ratios across volumes and
identifies persistent imbalance. It does not move data, rebalance volumes,
remount storage, or write files.

Its dedicated library validates reports, applies safety precedence, and
derives environment-aware observation plans without importing the turbo.
