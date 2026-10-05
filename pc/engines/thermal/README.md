# Thermal Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies bounded temperature, critical threshold, fan, and
thermal-headroom evidence. It distinguishes interactive foreground protection
from headless service protection without assuming permission to intervene.

It is analysis-only. It does not change fans, governors, workloads, shutdown
policy, files, or transport.
