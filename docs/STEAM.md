# Steam tracking

Steam uses the existing Windows Osmolog Companion and the same paired loopback
connection as MPV and Manatan. No new account, API key, public Steam profile,
third-party website, or network request to Steam is needed.

## Setup

1. Run a Companion build containing Steam support and reload the updated Osmolog extension.
2. Open **Connections → Steam → Connect Companion**. An existing Companion
   connection is reused. Older Companion builds show an update explanation.
3. Enable **Track Steam games** in the dashboard or expand **Steam game
   tracking** in Companion and enable it there.
4. Open a locally installed Steam game and bring its window forward.
5. Check **Language for this game**. Steam's configured language is a hint;
   choose an override if the game's audio or text uses a different language.
   If no language is available, no time counts until one is chosen.

Companion must remain running. Closing its window keeps it in the tray. Chrome
and the dashboard can be closed: sessions are journaled locally and delivered
when Osmolog reconnects. With Steam tracking enabled, MPV's auto-close setting
does not close Companion after MPV exits. Steam does not launch Companion
automatically; start Companion before playing.

## What counts

| Signal | Behavior |
| --- | --- |
| Recognized game window in the foreground | Counts active Gaming time at 1× real time |
| Alt-tab, minimized window, or inaccessible foreground window | Stops counting; no passive Gaming time |
| No keyboard, mouse, or supported controller input for the idle limit | Stops counting until input resumes |
| Pause tracking | Stops immediately; Resume tracking restarts when the game is focused |
| In-game pause menu | Not detected universally; use manual pause or the idle limit |
| PC sleep or a sampling gap over five seconds | Skips the unobserved gap |
| Game closed or switched | Finalizes the old session; a different game starts a new session |
| Unknown language or excluded game | Does not count |

The default idle limit is five minutes. Choose a longer limit for visual novels
and long cutscenes, or turn it off to count all focused time. Input observation
uses `GetLastInputInfo` and XInput, including held buttons/sticks with deadzones
to avoid ordinary analog drift. Controllers without XInput or a keyboard/mouse
mapping are not guaranteed to reset idle. There is no audio requirement: silent
games and visual novels still count. A pause menu with music cannot be reliably
distinguished from a cutscene by audio, so audio is not treated as a pause signal.

Focus and input are sampled about once a second. This is an estimate of engaged
play, not proof of reading or listening. Input-free cutscenes can be undercounted;
an open pause menu can count until the idle threshold. Manual pause resets when
the game changes or exits; language overrides and exclusions persist per app ID.

## Local detection and limitations

On Windows, Companion reads Steam's installation path from
`HKCU\Software\Valve\Steam\SteamPath` (with the standard installation folder as
a fallback), `steamapps/libraryfolders.vdf`, and `appmanifest_<appid>.acf`.
It matches the full foreground executable path against a game's installation
directory, with path boundaries and known helper/launcher exclusions. It keeps
the last detected game's process identity while the window is in the background
and verifies that the process still exists. A game first started in the background
appears when its window is brought forward. Library metadata refreshes every
30 seconds; new installs or language changes can take that long to appear.

These local Steam files are implementation details, not a Valve-supported API
contract. Missing, partially written, inaccessible, or changed formats stop or
limit detection and are retried. A protected/elevated game whose executable path
Windows will not expose is not counted. No administrator access, injected code,
game-memory reads, or anti-cheat bypass is used.

The connector currently covers Windows local Steam installations. Steam Deck,
macOS, Linux, Remote Play, non-Steam shortcuts, external-launcher games whose
executable is outside the Steam installation directory, and separate audio/text
language detection are not supported. Steam utilities can also have manifests;
use **Exclude this game** to prevent counting one. Two concurrently running games
are counted only while each is foreground; switching games starts a fresh session.

## Data and delivery

Only the current game's app ID, optional title, language and its source, timing,
and bounded connection/settings state reach the extension. Full installation
and executable paths, process IDs, raw input/controller state, and the installed
library stay inside Companion and are not written to its journal or sent to the
extension. `recordTitles: false` omits titles; app IDs are still recorded and can
identify a game. Account IDs present in Steam manifests are ignored. Credentials,
friends, achievements, and historical Steam playtime are not accessed.

Segments use `player: "steam"`, `activity: "gaming"`, and a stable
`steam-app:<appid>` source. Existing event receipts prevent duplicate imports,
including replay after deleting session details. MPV, Manatan, and Steam have
separate crash drafts. Controls are accepted through Electron's isolated preload
or the paired extension connection and are acknowledged before the dashboard
reports success. Steam preferences remain in local `companion.json` and are not
included in extension settings sync; recorded sessions follow ordinary history,
export, and optional sync behavior.

## Why not the Steam Web API?

Valve's [GetPlayerSummaries](https://partner.steamgames.com/doc/webapi/ISteamUser#GetPlayerSummaries)
is useful for profile/presence information, and
[IPlayerService](https://partner.steamgames.com/doc/webapi/IPlayerService)
provides aggregate playtime. Neither offers the local focus, device idle, or
universal in-game pause signals required for immersion tracking. A third-party
website wrapping these endpoints would add an account/network dependency without
supplying those missing signals.

[GetCurrentGameLanguage](https://partner.steamgames.com/doc/api/ISteamApps#GetCurrentGameLanguage)
belongs to a game's Steamworks context, rather than being a Web API for another
application's current audio or text. Language mappings follow Valve's
[language list](https://partner.steamgames.com/doc/store/localization/languages).
The OS signals are documented by Microsoft:
[GetLastInputInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo),
[XInputGetState](https://learn.microsoft.com/en-us/windows/win32/api/xinput/nf-xinput-xinputgetstate),
and [QueryFullProcessImageNameW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew).

## Validation

`npm test` in Companion includes Steam parser, library, input, tracking,
language/exclusion, sleep-gap, privacy, journal, and live loopback service tests.
From the extension workspace run `node tests/steam-connector.test.cjs` for actual
Companion segment ingestion and `node tests/steam-ui.test.cjs` for both interfaces.

Before publishing, manually play a local Steam game with keyboard/mouse and an
XInput controller; check alt-tab, idle timeout, a long cutscene, pause/resume,
in-game language changes with an override, game exit, PC lock/sleep, and Chrome
closed/reopened. Automated fixtures cannot establish compatibility with every
game, anti-cheat system, or controller.
