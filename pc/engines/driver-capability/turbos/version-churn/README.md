# Driver-capability Version Churn Turbo

Status: implementation complete locally; pending Odinn sign-off.

The version-churn turbo compares bounded name/vendor/version observations and
reports version changes without installing, replacing, loading, or changing drivers.

Its dedicated library validates reports, applies safety precedence, and derives
environment-aware observation plans without importing the turbo.
