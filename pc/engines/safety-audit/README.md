# Safety Audit Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies proposed action count, destructive count, user approval,
administrator requirement, and file/network mutation boundaries. Destructive
proposals are rejected in the audit result.

It is analysis-only. It does not execute actions, modify files, change network
state, or open transport.

The dedicated library is `pc/engines/safety-audit/library.js`. It classifies
normalized audit observations for the engine and remains fail-closed and
analysis-only.

The four independent turbo/library pairs are:

- `approval-drift`: explicit user-approval movement.
- `admin-boundary`: explicit administrator-required boundaries.
- `mutation-boundary`: file and network mutation evidence only.
- `proposal-risk`: action and destructive-action risk evidence.

Each pair is lazy and trigger-driven. It returns bounded evidence and review
plans only; it never executes proposals, mutates files, or changes network
state. Network evidence is conservative and does not imply a networking
optimization.
