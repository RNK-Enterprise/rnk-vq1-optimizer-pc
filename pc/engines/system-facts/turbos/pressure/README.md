# Pressure Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo computes a weighted resource-pressure score from CPU, memory, swap,
storage, and optional GPU observations. It reports the dominant resource,
headroom, confidence, active weights, and explainable recommendations. GPU
weight is redistributed when no GPU exists.

It is analysis-only and does not apply settings, access user files, or open a
mesh connection.

The dedicated library aggregates bounded pressure reports, ranks resource
signals, and builds conservative protection plans for headless and interactive
hosts. It remains separate from the turbo until the explicit connection
phase.
