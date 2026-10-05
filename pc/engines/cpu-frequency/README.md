# CPU Frequency Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies observed CPU governors and drivers as adaptive,
fixed-high, fixed-low, documented, vendor-specific, or unknown. It preserves
adaptive policy by default and requires explicit review before any documented
frequency control could be considered.

It is analysis-only. It does not change frequency policy, write files, alter
settings, or open transport.

The dedicated library is `pc/engines/cpu-frequency/library.js`. It classifies
normalized frequency observations for the engine and remains analysis-only.

The four implemented turbo analyses are `policy-shift`,
`load-governor-mismatch`, `frequency-residency`, and `boost-headroom`. Each
has its own implementation and dedicated library with tests, README, and
changelog. The eight completed turbo/library files pass the family regression
with 8 suites and 36 tests at 100/100/100/100/100/100. Mesh wiring, automatic
execution, and Odinn sign-off remain separate steps.
