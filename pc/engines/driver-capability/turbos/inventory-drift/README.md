# Driver-capability Inventory Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

The inventory-drift turbo compares bounded driver name/vendor identity sets and
reports additions or removals without installing, replacing, loading, or changing drivers.

Its dedicated library validates reports, applies safety precedence, and derives
environment-aware observation plans without importing the turbo.
