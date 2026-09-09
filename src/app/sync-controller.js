"use strict";

async function syncWithChrome(options = {}) {
  const service = options.service;
  if (!service) return { ok: false, openedChrome: false, message: "Companion is still starting." };

  const waitForConnection = options.waitForConnection || (async () => false);
  const waitForAcks = options.waitForAcks || (async () => false);
  let result = service.syncPending();
  let openedChrome = false;
  let chromeWasRunning = true;

  if (!result.connected) {
    chromeWasRunning = await options.isChromeRunning();
    if (!chromeWasRunning) {
      service.startPairing();
      openedChrome = options.launchChrome(service.dashboardUrl("settings"));
    }
    if (!await waitForConnection()) {
      return {
        ok: false,
        openedChrome,
        message: chromeWasRunning
          ? "Chrome is open, but Osmolog has not connected yet. Open Osmolog once, then try again."
          : openedChrome
            ? "Osmolog opened in Chrome. Finish pairing, then select Sync now again."
            : "Could not open Chrome. Open Osmolog once, then try again."
      };
    }
    result = service.syncPending();
  }

  if (!result.pending) return { ok: true, openedChrome, message: "Everything is already synced." };
  const acknowledged = await waitForAcks(result.eventIds);
  return acknowledged
    ? { ok: true, openedChrome, message: "Queued activity synced with Osmolog." }
    : { ok: false, openedChrome, message: "Some activity has not been confirmed by Osmolog yet. It is still saved on this computer; open the dashboard and try again." };
}

// Only wait for this sync's batch: live tracking may keep adding new segments.
async function waitForJournalAcks(service, eventIds, options = {}) {
  const now = options.now || (() => performance.now());
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 120000;
  const stallMs = options.stallMs ?? 30000;
  const retryMs = options.retryMs ?? 5000;
  const pending = () => service.journal.list();
  const remaining = new Set(eventIds || pending().map(event => event.eventId));
  const startedAt = now();
  let lastProgressAt = startedAt, nextRetryAt = startedAt + retryMs;
  while (remaining.size) {
    const current = new Set(pending().map(event => event.eventId));
    const previousCount = remaining.size;
    for (const id of remaining) if (!current.has(id)) remaining.delete(id);
    if (!remaining.size) return true;
    const timestamp = now();
    if (remaining.size < previousCount) lastProgressAt = timestamp;
    if (service.transport?.clients?.size === 0 || timestamp - startedAt >= timeoutMs || timestamp - lastProgressAt >= stallMs) return false;
    // Retry a stalled batch using the same event IDs. The extension's receipts
    // make replay safe; never acknowledge or remove journal data ourselves.
    if (timestamp >= nextRetryAt && timestamp - lastProgressAt >= retryMs) {
      service.syncPending([...remaining]);
      nextRetryAt = timestamp + retryMs;
    }
    await sleep(100);
  }
  return true;
}

module.exports = { syncWithChrome, waitForJournalAcks };
