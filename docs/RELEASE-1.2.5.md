# Companion 1.2.5

Approved web-preview design implemented in the Windows Companion.

- [x] Read release instructions and update the current extension Help note.
- [x] Rebuild dashboard and pass extension release validation (2.1.4).
- [x] Pass the full Companion test suite: 78 tests.
- [x] Check all four settings pages at the default 640 × 560 window size without scrolling.
- [x] Exercise status colors, pause/resume, connection prompts, update states, startup defaults, and player language controls in an isolated UI fixture.
- [x] Run the real Electron main process with isolated user data and hidden windows; verify IPC startup, resizing, exact 156 × 42 compact mode, restored expanded bounds, and persisted player language.
- [x] Build the Windows installer and portable executable without publishing.
- [x] Verify all 37 packaged source/asset files match the tested source and the packaged version is 1.2.5.

Windows login registration uses Electron's login-item API. Successful registration,
removal, failure rollback, and default settings are tested with an OS adapter;
an actual Windows sign-out/sign-in was not performed. Steam and Manatan window
opening requires Companion to remain running in the tray. MPV retains its launcher.
The existing user installation and startup settings were not changed during testing.

No extension archive or extension store submission is part of this Companion release.
