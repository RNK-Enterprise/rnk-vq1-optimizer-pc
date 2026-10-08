# Workstation Steward

The workstation-steward engine is the cross-platform policy layer for the
public PC optimizer. It connects resource budgets, foreground-game detection,
storage and drive evidence, file/download review, daily reports, local media,
playlist state, approved media-panel URLs, fixed natural-language intents, and
reversible action receipts.

It is deliberately facts-to-plan only. Windows, Linux, and macOS share the
input/output schema, but each platform reports its native capability boundary.
Native budget handoffs declare bounded CPU and memory hard-limit support where
the adapter implements it: Windows CPU/memory and Linux cgroup-v2 CPU/memory. I/O remains
priority-only and GPU remains observational. Runtime host proof is still
required before release certification. File moves, cleanup, process controls,
and media actions are previewed and require explicit approval.

Protected assets always win. Repositories, credentials, models, WSL data,
active runtimes, and user-selected paths are never inferred as disposable.
Unknown or malformed facts become review-required evidence.
