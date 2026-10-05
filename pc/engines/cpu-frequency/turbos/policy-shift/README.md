# CPU Frequency Policy-Shift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo observes normalized governor and driver changes across a bounded
sample window. It classifies stable policy, policy watch, frequent shifts,
unsupported policy evidence, insufficient evidence, and missing observations.

It is analysis-only. It never changes frequency policy, writes system files,
or opens transport. It is lazy and trigger-driven.
