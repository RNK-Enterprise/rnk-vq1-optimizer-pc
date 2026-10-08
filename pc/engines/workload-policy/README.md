# Workload Policy Engine

This PC-only engine observes declared developer, gaming, and gaming-plus-build
context and produces a bounded resource budget and foreground-protection plan.
It protects the foreground workload, keeps background work cooperative, and
records restoration intent for game exit or policy end.

The engine is analysis-only. It does not kill processes, change priorities,
write power settings, change GPU state, or alter files. Any future native
action must remain explicitly approved, capability-checked, and verifiable.

Its four turbos cover mode selection, resource budgets, foreground protection,
and restoration planning. Inputs may identify Codex, OpenCode, Node, Python,
WSL, compilers, models, or a game through declared workload classes, but the
engine does not infer permission from a process name alone.
