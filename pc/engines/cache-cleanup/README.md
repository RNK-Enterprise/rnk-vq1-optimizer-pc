# Cache Cleanup Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine provides a preview of explicitly system-owned, explicitly safe
cache candidates. User-owned, ambiguous, or incomplete cache evidence stays
outside the candidate set and requires review.

It is preview-only. It does not inspect paths, delete files, organize user
data, modify storage, or open transport.
