# Temp Cleanup Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine previews explicitly temporary, explicitly system-owned candidates.
User-owned, ambiguous, and incomplete temporary-file evidence stays outside
the candidate set and requires review.

It is preview-only. It does not inspect paths, delete files, organize user
data, modify storage, or open transport.
