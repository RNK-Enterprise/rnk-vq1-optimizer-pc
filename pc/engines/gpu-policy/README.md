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
