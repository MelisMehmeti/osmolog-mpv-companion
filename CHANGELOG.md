# Changelog

## 1.2.1 — 2026-09-09

- Track local Steam games with focus and idle detection, pause controls, and saved per-game languages.
- See the installed Companion version in a fixed footer beside the update status.
- Preserve queued activity and interrupted sessions more reliably, including separate Steam, MPV, and Manatan recovery.
- Keep Companion running for Steam tracking when MPV closes.

## 1.1.0 — 2026-08-30

- Added a per-user Windows installer that requires no administrator access.
- Added automatic background updates for the installed edition through public
  GitHub Releases; downloaded updates install after the companion closes.
- Kept the portable EXE as a separate manual-update download.

## 1.0.2 — 2026-08-30

- Added clear in-app guidance to keep the portable EXE in a permanent folder before enabling automatic MPV startup.

## 1.0.1 — 2026-08-30

- Added optional automatic opening with mpv and safe closing after mpv exits.
- Added active mpv configuration discovery for standard, portable, and custom locations.
- Fixed portable builds saving a temporary extracted executable path in the mpv launcher.
- Added Sync now, which reuses an open Chrome session and opens Osmolog only when Chrome is closed.

## 1.0.0 — 2026-08-29

- Added crash-safe mpv active/passive tracking for local video and audio.
- Added automatic background connection to Osmolog without requiring an open dashboard.
- Added the expanded companion window, movable compact timer, system tray, and fullscreen hiding.
- Added remembered language selection, cleaned titles, playback-speed credit, and Osmolog-today totals.
- Added automatic mpv startup integration and portable-mpv discovery.
