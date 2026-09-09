"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { syncWithChrome, waitForJournalAcks } = require("../src/app/sync-controller");

function serviceWith(results) {
  let syncIndex = 0;
  return {
    pairingCalls: 0,
    syncCalls: 0,
    syncPending() {
      this.syncCalls += 1;
      return results[Math.min(syncIndex++, results.length - 1)];
    },
    startPairing() { this.pairingCalls += 1; },
    dashboardUrl() { return "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/dashboard.html"; }
  };
}

test("Sync now uses an already connected Chrome extension without opening Chrome", async () => {
  const service = serviceWith([{ connected: true, pending: 2 }]);
  let processChecks = 0;
  let launches = 0;
  const result = await syncWithChrome({
    service,
    isChromeRunning: async () => { processChecks += 1; return true; },
    launchChrome: () => { launches += 1; return true; },
    waitForAcks: async () => true
  });
  assert.equal(result.ok, true);
  assert.equal(processChecks, 0);
  assert.equal(launches, 0);
  assert.equal(service.syncCalls, 1);
});

test("Sync now never opens a new window when Chrome is already running", async () => {
  const service = serviceWith([{ connected: false, pending: 1 }]);
  let launches = 0;
  const result = await syncWithChrome({
    service,
    isChromeRunning: async () => true,
    launchChrome: () => { launches += 1; return true; },
    waitForConnection: async () => false
  });
  assert.equal(result.ok, false);
  assert.equal(launches, 0);
  assert.equal(service.pairingCalls, 0);
  assert.match(result.message, /Open Osmolog once/);
});

test("Sync now opens Osmolog once when Chrome is closed, then replays the queue", async () => {
  const service = serviceWith([
    { connected: false, pending: 1 },
    { connected: true, pending: 1 }
  ]);
  let launches = 0;
  const result = await syncWithChrome({
    service,
    isChromeRunning: async () => false,
    launchChrome: () => { launches += 1; return true; },
    waitForConnection: async () => true,
    waitForAcks: async () => true
  });
  assert.equal(result.ok, true);
  assert.equal(result.openedChrome, true);
  assert.equal(launches, 1);
  assert.equal(service.pairingCalls, 1);
  assert.equal(service.syncCalls, 2);
});

function journalFixture(ids) {
  const pending = new Set(ids), retries = [];
  return { pending, retries, service: {
    journal: { list: () => [...pending].map(eventId => ({ eventId })) },
    transport: { clients: new Set([{}]) },
    syncPending: eventIds => retries.push(eventIds)
  } };
}

test("sync waits beyond three seconds and completes its captured batch while new activity remains queued", async () => {
  const fixture = journalFixture(["first", "second"]);
  let clock = 0;
  const result = await waitForJournalAcks(fixture.service, ["first", "second"], {
    now: () => clock,
    sleep: async ms => {
      clock += ms;
      if (clock >= 4000) fixture.pending.delete("first");
      fixture.pending.add("new-live-activity");
      if (clock >= 8000) fixture.pending.delete("second");
    }
  });
  assert.equal(result, true);
  assert.equal(clock, 8000);
  assert.deepEqual([...fixture.pending], ["new-live-activity"]);
  assert.deepEqual(fixture.retries, []);
});

test("a missed acknowledgement is recovered by replaying only the original pending IDs", async () => {
  const fixture = journalFixture(["original", "new-live-activity"]);
  let clock = 0;
  fixture.service.syncPending = ids => { fixture.retries.push(ids); fixture.pending.delete("original"); };
  assert.equal(await waitForJournalAcks(fixture.service, ["original"], {
    now: () => clock, sleep: async ms => { clock += ms; }
  }), true);
  assert.deepEqual(fixture.retries, [["original"]]);
  assert.equal(fixture.pending.has("new-live-activity"), true);
});

test("a stalled or disconnected extension cannot report success or erase pending activity", async () => {
  const fixture = journalFixture(["original"]);
  let clock = 0;
  assert.equal(await waitForJournalAcks(fixture.service, ["original"], {
    now: () => clock, sleep: async ms => { clock += ms; }
  }), false);
  assert.equal(clock, 30000);
  assert.equal(fixture.pending.has("original"), true);
  fixture.service.transport.clients.clear();
  assert.equal(await waitForJournalAcks(fixture.service, ["original"]), false);
  assert.equal(fixture.pending.has("original"), true);
});

test("Sync now passes the transmitted batch IDs to acknowledgement waiting", async () => {
  const service = serviceWith([{ connected: true, pending: 1, eventIds: ["sent-id"] }]);
  const result = await syncWithChrome({service, waitForAcks: async ids => {
    assert.deepEqual(ids, ["sent-id"]); return true;
  }});
  assert.equal(result.ok, true);
});
