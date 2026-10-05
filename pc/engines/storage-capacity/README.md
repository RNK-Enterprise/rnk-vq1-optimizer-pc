# Storage Capacity Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine aggregates bounded total and free storage capacity and classifies
minimum free-space headroom. It keeps missing capacity evidence explicit and
protects user ownership of files and storage layout.

It is analysis-only. It does not delete, move, organize, repair, remount,
modify files, or open transport.
