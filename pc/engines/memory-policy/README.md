# Memory Policy Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine evaluates whether normalized RAM and swap evidence supports the
documented balanced or background-low policy choices. High pressure holds the
current policy and destructive actions; unknown environments and observations
remain profile-required or observation-required.

It is analysis-only. It never changes memory policy, reclaims memory, clears
caches, accesses files, or opens transport.
