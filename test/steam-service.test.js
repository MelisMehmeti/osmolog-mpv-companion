"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter, once } = require("node:events");
const { WebSocket } = require("ws");
const { ConfigStore } = require("../src/config");
const { CompanionService } = require("../src/service");

test("real Companion transport confirms controls, journals Steam time, replays offline events and acknowledges delivery", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "osmolog-steam-service-"));
  const store = new ConfigStore({ directory }); store.load();
  const extensionId = "abcdefghijklmnopabcdefghijklmnop";
  store.update({ port: 49000 + Math.floor(Math.random() * 1000), extensionId, steam: { enabled: false } });
  const passiveSensor = () => Object.assign(new EventEmitter(), { start() {}, stop() {} });
  let enabled = false;
  const sensor = { setEnabled(value) { enabled = value; }, stop() { enabled = false; }, sample() {
    return { available: true, installed: true, focused: true, idleSeconds: 0,
      game: enabled ? { appId: "10", title: "Fixture game", configuredLanguage: "ja" } : null };
  } };
  const service = new CompanionService({ configStore: store, dependencies: {
    mpv: passiveSensor(), manatanSensor: passiveSensor(), steamSensor: sensor, focus: { isProcessFocused: () => false }
  } });
  let socket;
  t.after(async () => { socket?.terminate(); await service.shutdown("test"); await fs.rm(directory, { recursive: true, force: true }); });
  await service.start();
  const connect = async () => {
    const client = new WebSocket(`ws://127.0.0.1:${service.transport.port}`, { origin: `chrome-extension://${extensionId}` });
    const received = [];
    client.on("message", value => received.push(JSON.parse(String(value))));
    await once(client, "open");
    return { client, received };
  };
  const first = await connect(); socket = first.client;
  const control = patch => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => reject(new Error("Control was not acknowledged")), 2000);
    const listener = value => { const message = JSON.parse(String(value)); if (message.requestId !== requestId) return;
      clearTimeout(timeout); socket.off("message", listener); resolve(message); };
    socket.on("message", listener); socket.send(JSON.stringify({ type: "steamControl", requestId, patch }));
  });
  assert.equal((await control({ enabled: true })).ok, true);
  assert.equal(service.publicState().player, "steam");
  assert.equal(service.config.steam.enabled, true);
  await new Promise(resolve => setTimeout(resolve, 1150));
  assert.equal((await control({ appId: "10", paused: true })).ok, true);
  assert.equal(service.publicState().steam.reason, "manual-pause");
  const queued = service.journal.list();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].player, "steam");
  assert(queued[0].realSeconds >= 1 && queued[0].realSeconds < 3);
  assert(first.received.some(message => message.type === "segment" && message.eventId === queued[0].eventId));
  socket.close(); await once(socket, "close");
  const second = await connect(); socket = second.client;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(second.received.some(message => message.type === "segment" && message.eventId === queued[0].eventId));
  socket.send(JSON.stringify({ type: "ack", eventId: queued[0].eventId }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(service.journal.list().length, 0);
  assert.equal((await control({ appId: "10", language: "en" })).ok, true);
  assert.equal(service.config.defaultLanguage, "ja");
  assert.equal(service.publicState().steam.languageOverride, "en");
  assert.equal((await control({ enabled: false })).ok, true);
  assert.equal(service.publicState().steam.reason, "disabled");
});
