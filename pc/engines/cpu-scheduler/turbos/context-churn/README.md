# CPU Scheduler Context-Churn Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo measures normalized context-switch rates, volatility, and direction
reversals across a bounded sample window. It classifies insufficient evidence,
missing observations, volatile churn, high churn, reversal watch, and stable
churn.

It is analysis-only. It never changes scheduler policy, process priority,
affinity, files, settings, or transport state. It is lazy and trigger-driven.
