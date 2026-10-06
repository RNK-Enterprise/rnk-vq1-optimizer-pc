# Cache Cleanup Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine provides a preview of explicitly system-owned, explicitly safe
cache candidates. User-owned, ambiguous, or incomplete cache evidence stays
outside the candidate set and requires review.

It is preview-only. It does not inspect paths, delete files, organize user
data, modify storage, or open transport.

The dedicated library is `pc/engines/cache-cleanup/library.js`. It classifies
normalized cache observations for the engine and remains analysis-only.

The four dedicated turbo/library pairs are:

- `candidate-drift`: compares explicitly named, system-owned, safe candidates
  and their byte totals.
- `ownership-boundary`: keeps user-owned, system-safe, and ambiguous evidence
  separate and refuses inferred permission.
- `size-trend`: observes explicit cache-size increases and decreases without
  inspecting paths.
- `evidence-completeness`: requires explicit name, size, ownership, and safety
  metadata before evidence can be considered complete.

Each pair is lazy and trigger-driven. Recommendations are preview or review
plans only; no pair inspects paths, deletes files, organizes data, modifies
storage, or opens network transport.
