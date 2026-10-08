# Download Guard Engine

Download Guard preflights a bounded download request against observed storage
volumes. It reports whether the requested destination has headroom, suggests a
non-system destination such as E:, and identifies incomplete, duplicate, or
hash-review conditions.

It does not start downloads, move files, delete files, overwrite targets, or
trust a large-file heuristic as permission. Protected paths and protected
volumes win over placement convenience. The result is a reviewable plan with
an empty action list until a separate approved native capability is added.

The four turbos cover space preflight, destination selection, duplicate
review, and hash verification.
