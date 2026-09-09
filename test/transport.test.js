"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { WebSocket } = require("ws");
const { CompanionTransport } = require("../src/transport/websocket-server");

test("transport accepts only the configured Chrome extension Origin", async t => {
  const extensionId = "abcdefghijklmnopabcdefghijklmnop";
  const transport = new CompanionTransport({ port: 0, extensionId });
  const port = await transport.start();
  t.after(() => transport.close());
  assert(port > 0);
  assert.equal(port, transport.server.address().port);
  assert.equal(port, transport.port);
  const allowed = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `chrome-extension://${extensionId}` });
  const helloPromise = once(allowed, "message");
  await once(allowed, "open");
  const [hello] = await helloPromise;
  assert.equal(JSON.parse(String(hello)).type, "hello");
  allowed.close();
  const denied = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "https://example.com" });
  const [error] = await once(denied, "error");
  assert.match(error.message, /403|unexpected server response/i);
  denied.terminate();
});

test("pairing captures one Chrome extension Origin and closes again", async t => {
  const extensionId = "fefhfpppnnlocjddkgnaoknbhlmklngi";
  const otherExtensionId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const transport = new CompanionTransport({ port: 0, extensionId: "PUT_EXTENSION_ID_HERE" });
  const port = await transport.start();
  t.after(() => transport.close());

  const beforePairing = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `chrome-extension://${extensionId}` });
  const [beforeError] = await once(beforePairing, "error");
  assert.match(beforeError.message, /401|403|unexpected server response/i);

  const pairedPromise = once(transport, "paired");
  transport.startPairing();
  const allowed = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `chrome-extension://${extensionId}` });
  await once(allowed, "open");
  const [pairedId] = await pairedPromise;
  assert.equal(pairedId, extensionId);
  assert.equal(transport.extensionId, extensionId);
  assert.equal(transport.pairingRemaining(), 0);
  allowed.close();

  const denied = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `chrome-extension://${otherExtensionId}` });
  const [deniedError] = await once(denied, "error");
  assert.match(deniedError.message, /401|403|unexpected server response/i);
});
