# Companion 1.2.7

- Correct the Home instruction to require playback or a running Steam game.
- Sync a captured batch instead of waiting for an empty queue during continuing playback.
- Allow confirmations for up to two minutes while making progress; report a stall after 30 seconds without a confirmation.
- Retry only unconfirmed IDs after five seconds without progress. Preserve journal entries until the extension acknowledges them.
- Publish pending-count changes immediately and keep tracking controls available during sync.

Validation: 88 Companion tests passed, including delayed acknowledgements, new live activity during a sync, real WebSocket replay, genuine stalls, and retained journal data. Browser UI checks passed. Extension idempotency and pending-queue tests passed. Dashboard release notes were rebuilt and release validation passed. The user's queued events passed the current extension's segment validator; this does not claim they have been imported by the running extension.

GitHub's version-tag workflow tests and builds the public installer and portable app before publication. No existing user queue is discarded by this update.
