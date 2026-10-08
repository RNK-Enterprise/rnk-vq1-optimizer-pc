# Changelog

## 2026-10-08

- Added the cross-platform workstation-steward policy layer.
- Added bounded resource/game/process review, storage/file/download evidence,
  daily trend reports, local media and playlist cataloguing, fixed assistant
  intents, media URL review, and reversible action receipts.
- Kept all host mutations behind explicit platform authority and approval.
- Declared platform-specific CPU/memory hard-budget capability boundaries while
  keeping I/O priority and GPU observation-only.
- Updated Linux CPU capability reporting to reflect the approved cgroup-v2
  hard-limit adapter when the host exposes its CPU controller.
