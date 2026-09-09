# Osmolog Companion

Osmolog Companion counts video and audio played in [mpv](https://mpv.io/) and
the native Manatan Windows app, and tracks local Steam games, then sends sessions to the
Osmolog Chrome extension. It runs as a small Windows utility; the existing
Osmolog dashboard remains the place for history, goals, Sources, and analytics.

The companion shows only what is useful while watching: connection state,
current title, language, file time, total Osmolog time today, playback speed,
and the Active/Passive split. Minimize it to the same compact timer badge used
by the extension, or close it to the system tray.

## Download

Download the latest release from
[GitHub Releases](https://github.com/MelisMehmeti/osmolog-mpv-companion/releases):

- **Setup** is recommended. It installs for the current Windows user without
  administrator access and downloads future companion updates automatically.
- **Portable** is the existing no-install EXE. Place it somewhere permanent
  before enabling automatic MPV startup; portable updates remain manual.

The current builds are unsigned. Windows SmartScreen may therefore show an
Unknown publisher warning. Verify that the download came from this repository
and compare its SHA-256 checksum with the release notes before running it.

Requirements:

- Windows 10 or 11, 64-bit
- mpv, the Manatan Windows app, and/or Steam games
- the Osmolog Chrome extension

## Set up mpv once

In Companion 1.2.4 or later, select **Set up MPV**. If asked, select `mpv.exe`
or `mpv.net.exe`. Companion uses a previously detected configuration folder,
an existing `portable_config` beside the selected application, or the standard
per-user configuration folder. It preserves other settings and creates a backup
before changing an existing file. Close and reopen MPV afterwards.

Custom profiles that override the connection setting need manual setup. For
older Companion versions, create `mpv.conf` if it does not exist and add this line:

```ini
input-ipc-server=\\.\pipe\osmolog-mpv
```

Common locations:

- Standard mpv: `%APPDATA%\mpv\mpv.conf`
- Portable mpv: `portable_config\mpv.conf` beside `mpv.exe`

Restart mpv after saving the file, then start Osmolog Companion.

## Connect Osmolog once

1. Start the companion and either mpv or Manatan.
2. Open Osmolog in Chrome.
3. Open the dashboard, then go to **Connections → Apps & players**.
4. In the **MPV Companion** card, select **Reconnect now**.
5. Approve Chrome's one-time local access prompt if it appears.

After that first permission, the dashboard does **not** need to be open. The
extension reconnects to the companion in the background. The trusted extension
installation is remembered automatically; users never need to copy an
extension ID.

If Osmolog is reinstalled and Chrome gives it a different ID, start pairing in
the companion and open Osmolog once to trust the new installation.

## Everyday behavior

### Steam

Open **Connections → Steam** or expand **Steam game tracking** in Companion.
Enable tracking, bring a game window forward, and choose which language receives
its tracked time. Steam games count as **Active Gaming** while focused and
**Passive Gaming** while running in the background, with configurable idle detection,
manual pause/resume, per-game language overrides, and exclusions. In-game pause
menus and separate audio/text languages cannot be detected universally.

See [Steam setup, behavior, and limitations](docs/STEAM.md). This requires a
Companion build containing Steam support; existing installed builds need updating.

### Media players

- Focused, audible, unpaused mpv playback counts as **Active**.
- Unfocused, audible, unpaused playback counts as **Passive**.
- Audible native Manatan playback follows the same Active/Passive rule. The
  companion uses Manatan's Windows media state when available and its local
  process-audio session as a fallback; no Manatan modification is required.
- Pause, mute, volume zero, buffering, seeking, EOF, and no loaded file do not
  count.
- Audio-only playback counts normally.
- Playback speed is credited as real time multiplied by speed, clamped to
  1×–2× by default.
- Changing Language in the companion updates the current file and becomes the
  default for the next session.
- **−** switches to the movable compact timer.
- **×** keeps tracking in the Windows tray.
- The companion hides automatically while mpv is fullscreen.
- Enable **Automatically open when MPV opens** to let mpv start the companion
  and let the companion safely close after mpv closes.
- Select **Sync now** to send queued activity immediately. If Chrome is already
  open, Osmolog uses that running browser without opening another window. If
  Chrome is closed, the companion opens Osmolog once so it can reconnect.

When automatic opening is enabled, the companion asks mpv for its active
configuration folder and installs only its managed `osmolog-companion.lua`
script there. This supports standard, portable, and custom mpv locations
without asking users to enter a path. If mpv is closed when you enable the
setting, open mpv once to finish setup. If you move the portable companion
executable, run it once manually so the launcher can repair its saved path.

The installed edition checks the public GitHub Releases feed after startup and
periodically while it is running. The footer shows download progress, then
**Update ready · restart required**. Choose **Restart to update** to save current
activity, open the installer, and reopen Companion automatically. Separate
saving and installing messages explain what is happening. You can keep tracking
until you choose to restart. Closing **×** only hides Companion in the tray;
quitting from the tray also applies a downloaded update. The portable edition
never performs automatic update checks.

## Reliability and privacy

Completed segments are journaled before delivery. Chrome may be closed:
unacknowledged time remains in `%APPDATA%\Osmolog\pending.jsonl` and is replayed
when the extension reconnects. An in-progress segment is checkpointed for crash
recovery.

Chrome does not need to be open when mpv closes. The companion finalizes the
current activity and stores it locally before exiting; it will be delivered the
next time Osmolog reconnects.

The full media path stays inside the companion. Osmolog receives only the
resolved language, cleaned title, timing, selected track-language tags,
subtitle visibility, and video/audio classification. Set `recordTitles` to
`false` in `%APPDATA%\Osmolog\companion.json` to omit titles.

See [PRIVACY.md](PRIVACY.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the complete local data and transport design.

## Troubleshooting

### Companion says “Waiting for MPV”

Confirm that `mpv.conf` contains the named-pipe line exactly, save it, and
fully restart mpv. Only one mpv instance can own the fixed pipe.

### Manatan is open but not counting

Start a video and leave Osmolog Companion running. The Manatan card should say
that the app is detected, then switch to active or passive tracking when the
Windows audio session becomes active. Muted or volume-zero playback does not
count.

### Companion says “Reconnecting to Osmolog”

Wait up to 30 seconds. If it remains disconnected, reload Osmolog from
`chrome://extensions`, then leave the companion open. The dashboard does not
need to remain open.

### Time is queued

Queued segments are intentional when Chrome or Osmolog is unavailable. Do not
delete `%APPDATA%\Osmolog\pending.jsonl`; it drains after reconnection.

## Development

Use Node.js 24, matching the automated test environment.

```powershell
npm install
npm test
npm start
```

Build the portable executable locally:

```powershell
npm run dist
```

Artifacts are written to `dist/`. Pushing a tag such as `v1.0.2` runs the
Windows release workflow and attaches the executable and its SHA-256 checksum to a
GitHub Release.

## Current scope

The companion supports Windows with mpv, the native Manatan app, and local Steam games. VLC,
macOS, Linux, native messaging, and code signing are not included yet.

## License

The companion source code is available under the [MIT License](LICENSE).
The Osmolog name, logo, and product identity are not licensed for third-party
builds; see [TRADEMARKS.md](TRADEMARKS.md).

### Journal preservation

Unacknowledged segments have no age expiry and are not removed when the journal passes its size warning threshold. Drafts are cleared only after a durable journal append; MPV and Manatan keep independent drafts. Damaged bytes are copied to `.damaged-*` recovery files before later writes. These files remain local until explicitly removed. Closing or deleting the application is not a substitute for confirming queued time reached the extension.

Companion 1.2.0 includes Steam tracking and the journal reliability fixes. Users of 1.1.0 need to install the updated Companion; reconnecting 1.1.0 cannot add Steam support.
