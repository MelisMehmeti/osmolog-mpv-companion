# Privacy

Osmolog Companion runs locally on Windows and listens only on loopback
(`127.0.0.1`, ports 47823–47827). It accepts WebSocket connections only from
the paired Osmolog Chrome extension Origin.

## Data read from mpv

- playback, pause, seeking, buffering, mute, volume, speed, and focus state;
- media title/filename and executable directory;
- selected audio/subtitle language metadata and subtitle visibility;
- whether the file contains video or audio only.

## Data read from Manatan

- whether a local `Manatan.exe` process and its Windows audio session are
  active, paused, muted, or volume-zero;
- Manatan's Windows media-session title, timeline, and playback rate when the
  app publishes them;
- whether the Manatan window is foreground, for Active/Passive classification.

The companion does not inject code into Manatan, read its library database, or
send commands to its local API. The Windows audio-session fallback reports the
process identity and playback state, not the audio itself.

## Data read from Steam (only when enabled)

Companion reads the local Steam installation path, library manifests, game names,
app IDs, and configured languages. It matches the foreground executable against
an installation directory and checks whether the last game process still exists.
Keyboard/mouse last-input timing and XInput controller state are reduced to idle
status locally. It does not log keys, record audio/screenshots, read game memory,
inject code, request Steam credentials, retain Steam account IDs, or call a Steam
or third-party Web API. Paths, process IDs, raw input state, and the full installed
library are not sent to the extension or written to the session journal.

Game language overrides, exclusions, and the idle limit are stored locally in
`companion.json`. The game app ID and optional title are stored with recorded
Gaming sessions; an app ID can identify a game even with `recordTitles` disabled.
Live game status goes to the paired extension while connected. Settings for Steam
tracking are off by default and can be disabled in Companion or Connections.

## Data sent to Osmolog

- active and passive duration;
- cleaned title, unless `recordTitles` is disabled;
- resolved language and limited track-language metadata;
- playback-speed measurements and video/audio classification;
- Steam game app ID, Gaming classification, language source, and bounded live settings/status;
- anonymous local event/session identifiers used for duplicate protection.

The full media path is never sent to the extension and is not written to the
default log. The companion does not contact Osmolog's cloud services itself.
Once the extension accepts a segment, that segment follows the extension's
normal local storage, export, and optional sync behavior.

The installed edition checks this project's public GitHub Releases feed over
HTTPS and downloads a newer installer when available. These requests disclose
ordinary network information such as the device's IP address and user agent to
GitHub, but they do not include media titles, paths, playback activity,
languages, settings, or Osmolog history. The portable edition does not perform
automatic update checks.

## Local files

The companion stores configuration and crash-recovery data under
`%APPDATA%\Osmolog`:

- `companion.json`: settings and the paired extension ID;
- `pending.jsonl`: completed segments waiting for extension acknowledgement;
- the current draft checkpoint used after an unexpected stop.

Removing the portable executable or uninstalling the installed edition does
not automatically remove this data. Delete `%APPDATA%\Osmolog` manually if you
also want to remove companion data.

Unacknowledged journal entries do not expire by age or size. A large journal produces a warning and remains queued. If a journal or draft is damaged, a local `.damaged-*` copy preserves its original bytes for recovery; it can contain the same private media metadata as the original local file. These recovery copies are not uploaded and remain until explicitly removed with the Companion data.
