# Companion UI validation

The redesign retains the existing 640 × 560 window, compact overlay, native controls, tracking state, and settings persistence.

Run the normal regression suite with `npm ci` and `npm test`.
For optional visual and native Windows checks, install the browser test tool with `npm install --no-save --package-lock=false playwright`, then `npx playwright install chromium`.
Run `node test/ui/redesign.cjs` and, on Windows, `node test/ui/native.cjs` from the repository root.
Screenshots and isolated test data are written to ignored `artifacts/` folders.

Validated: 84 unit/integration tests; live, paused, passive, idle, and disconnected UI; all settings tabs; successful/failed sync and loading; update states; keyboard navigation; narrow/wide layouts; native IPC, resize, compact dimensions, and persisted language.
JavaScript syntax and the local unpacked Windows build passed. No separate lint/typecheck scripts are configured.

No daily goal bar is shown because the backend supplies no goal-progress data. Last-synced timestamps reflect successful manual syncs in the current app run; otherwise the UI shows the actual queue/connection state. Start minimized remains independent of Windows startup, matching existing behavior.
