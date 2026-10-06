# Driver-capability Identity Completeness Turbo

Status: implementation complete locally; pending Odinn sign-off.

The identity-completeness turbo detects missing bounded driver name, vendor,
version, and evidence fields. It is observation-only and never changes drivers.

Its dedicated library validates reports, applies safety precedence, and derives
environment-aware observation plans without importing the turbo.
