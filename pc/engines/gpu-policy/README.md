# GPU Policy Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies GPU vendor, model, driver, and observation evidence
from the trusted system-facts snapshot. It distinguishes no-GPU hosts,
incomplete observations, documented driver families, and vendor-specific
evidence for conservative policy review.

It is analysis-only. It does not change GPU policy, drivers, files, or
transport state. Vendor-specific values are preserved as evidence and never
treated as permission for undocumented tweaks.

The dedicated `library.js` classifies vendor and driver evidence, compares
policy snapshots, and emits immutable local review envelopes without changing
GPU policy or drivers.

The turbo set is now four bounded, lazy-loaded analyses: `driver-drift`,
`vendor-mix`, `observation-boundary`, and `evidence-completeness`. Each uses
the declared GPU-policy triggers and returns recommendations only; none applies
GPU, driver, file, network, or transport changes.

Each turbo has its own dedicated library for report validation, aggregation,
environment-aware planning, and immutable local envelopes. The family currently
contains four turbo/library pairs and is verified locally at 8 suites, 40 tests,
and 100% statements, branches, functions, and lines.
