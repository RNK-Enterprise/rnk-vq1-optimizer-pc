# Capability status

This is the current source-level status of the public PC optimizer. A feature
marked implemented has code and automated tests. A feature marked live proof
pending has code and tests but still needs the target operating system,
administrator boundary, or release environment to be exercised. Unsupported
means the authority deliberately refuses rather than pretending to enforce it.

## Wishlist closure

| Area | Current status | Boundary |
| --- | --- | --- |
| System Drive Guard | Implemented | Windows live cleanup and pressure recovery still need target-machine proof. |
| Storage and drive health | Implemented | SMART/filesystem results depend on host tools and device permissions. |
| File organizer and placement | Implemented | Preview, protected roots, copy verification, apply, and rollback are present. |
| Download Guard | Implemented | It guards explicit roots; it does not intercept browser downloads. |
| Developer Mode | Implemented | Windows/Linux priority, CPU/RAM/I/O, and optional NVIDIA compute-memory evidence exist; live admin proof remains. |
| Gaming Mode | Implemented | Foreground evidence and approved background priority changes exist; no GPU/FPS/network cap. |
| Gaming + Build Mode | Implemented | Hard CPU/RAM limits use Windows Job Objects or Linux cgroups; live proof remains. |
| Battery and power | Implemented | Telemetry and documented profiles exist; ASUS-specific live behavior is unverified. |
| Thermal and cooling | Implemented | Read-only sensors exist; undocumented firmware fan control is refused. |
| Memory and pagefile | Implemented | Pagefile/swap is separate system-managed evidence and never a cleanup target. |
| Process and startup | Implemented | Role, usage, cumulative and sampled I/O, process-rate evidence, stop-impact, startup preview, apply, and restore exist. |
| Network observation | Implemented | Interface rates, connections, and explicit per-process evidence exist; shaping does not. |
| Media library | Implemented | Local catalogue, metadata, duplicates, favorites, recents, and playlists exist. |
| Music player | Implemented | Browser-owned local playback state and host are present; no downloader is included. |
| Media panel | Implemented | HTTPS allow-list handoff exists; it does not fetch or bypass services. |
| Daily workstation report | Implemented | History, HTML/JSON/Markdown delivery, daemon, OS-user scheduling, and sampled process CPU/I/O leaders exist. |
| History and trends | Implemented | Bounded append-only history and multi-day trend reduction exist. |
| Local workstation assistant | Implemented | Deterministic facts-only routing, preview plans, and an optional bounded language adapter exist. |
| Protected assets | Implemented | Protected roots and role/path precedence refuse uncertain destructive work. |
| Preview, verify, audit | Implemented | Covered authorities produce receipts and measured verification; rollback is authority-specific. |

## Remaining product or certification work

These are the actual remaining items, not a second copy of the completed
wishlist:

1. Packaged cross-platform desktop shell/tray application. Dashboard, steward,
   tray, and System Drive Guard launchers now exist; live host/tool proof
   remains.
2. Platform-native per-process network byte counters and traffic shaping. The
   Linux and macOS facts paths now consume bounded NetHogs/nettop evidence when
   available; Windows counters and all traffic shaping remain explicit
   host-dependent or unsupported.
3. Safe GPU hard caps and universal frame-rate control. Current GPU evidence is
   observational and no platform-safe portable cap is claimed.
4. macOS hard CPU/RAM/I/O limits. macOS returns explicit unsupported results.
5. Browser/OS-integrated download interception and destination redirection.
   A native-messaging preflight bridge and advisory browser adapter now exist;
   browser-specific cancellation and destination redirection remain outside
   the authority until a safe host contract is proven.
6. Full service/decoder media integration. Local metadata and host handoff are
   implemented; the optimizer does not ship a decoder or service downloader.
7. Live release evidence: clean-machine install, Windows 11 ROG execution,
   administrative applies, live gateway, signed release tag, checksum, and
   build attestation still require their exact environments and Odinn's signoff.

The seven remaining rows are deliberately separated from source completeness:
unsupported platform authorities and live certification cannot be honestly
closed by adding tests or changing documentation.
