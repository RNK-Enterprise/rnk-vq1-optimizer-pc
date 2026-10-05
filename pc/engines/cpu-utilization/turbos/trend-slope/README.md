# CPU Utilization Trend-Slope Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo computes a bounded least-squares utilization slope and range
volatility. It classifies rising, falling, volatile, flat, no-observation,
and insufficient windows without changing CPU policy or emitting actions.

Its dedicated library is `library.js`. The library validates turbo reports,
merges slope and volatility evidence, builds environment-aware observation
plans, and remains independent of the turbo implementation.
