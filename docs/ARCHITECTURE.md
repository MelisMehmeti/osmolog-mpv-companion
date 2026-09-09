# Architecture

```text
mpv named pipe ───────┐
                     ├─► Companion service ──► per-player tracking engines ──► crash-safe journal
Manatan Windows media┘
and process-audio state
      │                                      │
      │ local state                          │ acknowledged segments
      ▼                                      ▼
mini window / tray ◄── loopback WebSocket ── Osmolog extension
                                                │
                                                ▼
                                  normal history, Sources, goals and sync
```

## mpv integration

The companion observes `\\.\pipe\osmolog-mpv`. Duration uses monotonic
`process.hrtime.bigint()` deltas rather than media position or wall-clock
differences. Seeking and buffering close or suspend countable intervals.

MPV's `focused` property is preferred for Active/Passive classification. When
unavailable, the Windows foreground-window detector uses the mpv process ID.

## Manatan integration

Manatan embeds libmpv inside `Manatan.exe`, so it has no external mpv named
pipe. A long-lived, hidden Windows Runtime reader observes the app's system
media session. If Manatan does not publish that richer session, Core Audio
session enumeration supplies play/pause, mute, volume, and process identity.
The foreground-window detector classifies active versus passive time. Both
paths are read-only and require neither injection nor a Manatan modification.

MPV, Manatan, and Steam keep independent current drafts and session IDs. Their
completed segments share the same journal and acknowledgement protocol.

## Steam integration

An opt-in local library scanner matches Steam installation directories to the
foreground executable. Windows input timing and XInput state drive idle detection;
game language comes from the local Steam manifest or a per-game user override.
Steam uses active and passive Gaming segments at real time based on focus, with manual pause and game
exclusions. It skips unobserved gaps over five seconds. It shares the existing
service, journal, and paired transport; see [Steam design and limits](STEAM.md).

## Delivery

The extension initiates a WebSocket connection to loopback ports 47823–47827.
First-run pairing temporarily accepts a valid Chrome extension Origin and then
pins its 32-character ID. Every segment has a stable event ID. The companion
keeps it in the journal until the extension acknowledges it; the extension also
keeps a bounded seen-ID set, making retries idempotent on both sides.

The extension maintains a heartbeat while connected and uses a Chrome alarm to
wake its Manifest V3 service worker and reconnect when the dashboard is closed.

## Process model

Electron owns the mini window and tray. Closing the window hides it; selecting
Quit from the tray shuts down tracking cleanly. A managed Lua script starts the
packaged executable when mpv opens. The single-instance lock prevents duplicate
desktop processes.

## Configuration

`%APPDATA%\Osmolog\companion.json` is bounded and normalized on load. Folder
rules use case-insensitive longest-prefix matching. Port changes require a
restart; language and most tracking settings update live.
