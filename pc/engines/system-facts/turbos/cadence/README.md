# Cadence Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo selects a bounded observation interval from current resource
pressure, recent snapshot volatility, host environment, trigger urgency, and
capability confidence. It keeps unknown environments conservative, samples
workload changes sooner, and permits longer intervals only when observations
are stable and pressure is low.

The turbo is advisory-only. It does not apply settings, access user files,
open network connections, or connect to the optimizer mesh.
