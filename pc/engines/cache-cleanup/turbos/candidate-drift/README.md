# Cache-Cleanup Candidate-Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo compares explicitly named, system-owned, safe cache candidates
over bounded samples. Incomplete, ambiguous, and user-owned rows remain review
evidence and are not candidates.

It is preview-only. It does not inspect paths, delete files, organize data,
modify storage, or open transport. It fires only for an explicit supported
trigger and loads its analysis when invoked.
