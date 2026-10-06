# Organization Preview Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine reports proposed categories for user-file organization. User-owned
items require explicit approval; unknown categories remain observation review.

It is preview-only. It does not move, rename, delete, overwrite, inspect
paths, modify files, or open transport.

The dedicated library is `pc/engines/organization-preview/library.js`. It
classifies normalized organization proposals for the engine and remains
preview-only until explicit user approval exists.

The four dedicated turbo/library pairs are:

- `category-drift`: compares explicit organization categories and reports
  bounded category changes.
- `ownership-review`: reports explicit user-owned approval state and never
  infers consent.
- `proposal-drift`: compares explicit proposal text and reports proposal
  changes without applying them.
- `item-inventory`: compares explicit item identities and reports additions or
  removals without opening or mutating files.

Each pair is lazy and trigger-driven. Its recommendation is a review or
observation plan; no pair performs organization, deletion, renaming,
overwriting, path inspection, or network transport.
