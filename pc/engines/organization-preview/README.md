# Organization Preview Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine reports proposed categories for user-file organization. User-owned
items require explicit approval; unknown categories remain observation review.

It is preview-only. It does not move, rename, delete, overwrite, inspect
paths, modify files, or open transport.

The dedicated library is `pc/engines/organization-preview/library.js`. It
classifies normalized organization proposals for the engine and remains
preview-only until explicit user approval exists.
