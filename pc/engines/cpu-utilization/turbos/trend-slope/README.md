# CPU Utilization Trend-Slope Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo computes a bounded least-squares utilization slope and range
volatility. It classifies rising, falling, volatile, flat, no-observation,
and insufficient windows without changing CPU policy or emitting actions.
