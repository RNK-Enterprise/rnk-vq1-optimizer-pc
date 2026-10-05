# CPU Utilization Burst-Window Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo analyzes a bounded suffix of normalized CPU snapshots. It measures
observed samples, burst rate, peak utilization, mean utilization, and the
largest adjacent rise. It is analysis-only and does not change CPU policy.

The turbo requires a supported trigger, validates each snapshot, bounds the
window to 64 samples, and returns an empty action list. It does not import the
CPU-utilization engine or its library.

Its dedicated library is `library.js`. The library validates turbo reports,
merges bounded observations, builds environment-aware observation plans, and
does not import or call the turbo implementation.
