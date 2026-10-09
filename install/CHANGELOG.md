# PC installation changelog

## 2026-10-06

- Added an explicit headless-or-interactive installation choice for Linux and Windows.
- Refused to guess the mode in non-interactive shells.
- Stored only the selected optimizer mode in the user application configuration area.
- Added the same immutable-ref, clean-checkout, facts-first installer flow for macOS.
- Added a configurable 5 GiB pre-install free-space floor so dependency
  installation refuses before it worsens a pressured target volume.
