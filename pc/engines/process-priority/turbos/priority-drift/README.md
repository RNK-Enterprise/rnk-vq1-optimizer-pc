# Process Priority: Priority Drift Turbo and Library

Status: implementation complete locally; pending Odinn sign-off.

The turbo compares bounded normalized process-priority signatures and reports
stable, observed, sustained, empty, and incomplete evidence. The dedicated
library validates and merges those reports, derives explicit interactive or
headless observation plans, and wraps trigger evidence in immutable envelopes.

Both files are local analysis components. They do not import or delegate to
each other, mutate priorities or processes, modify user files, or open HTTP,
API, REST, socket, or other transport paths.
