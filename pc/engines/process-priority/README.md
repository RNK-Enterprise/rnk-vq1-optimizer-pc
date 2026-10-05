# Process Priority Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies documented process priority labels and reports
foreground, protected, unknown, and elevated-priority counts. Unsupported or
missing labels remain unknown rather than being treated as permission to
change a process.

It is analysis-only. It does not renice, terminate, suspend, modify files, or
open transport.
