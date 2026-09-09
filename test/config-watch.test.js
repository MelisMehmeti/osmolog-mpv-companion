"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { ConfigStore } = require("../src/config");

test("configuration watcher resolves path aliases and reloads external edits and replacements", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "osmolog-config-watch-"));
  const store = new ConfigStore({ directory });
  t.after(() => {
    store.close();
    assert.equal(path.dirname(directory), os.tmpdir());
    fs.rmSync(directory, { recursive: true, force: true });
  });
  store.load();
  const canonical = fs.realpathSync.native(directory);
  t.diagnostic(`Watch directory: ${directory}; canonical: ${canonical}`);
  const realWatch = fs.watch;
  const watched = [];
  t.mock.method(fs, "watch", (target, ...args) => { watched.push(target); return realWatch(target, ...args); });
  store.watch(); store.watch();
  assert.deepEqual(watched, [canonical], "watch the resolved path exactly once");
  let changed = once(store, "change", { signal: AbortSignal.timeout(5000) });
  fs.writeFileSync(store.file, JSON.stringify({ ...store.value, defaultLanguage: "ko" }));
  assert.equal((await changed)[0].defaultLanguage, "ko");
  changed = once(store, "change", { signal: AbortSignal.timeout(5000) });
  const replacement = path.join(directory, "replacement.json");
  fs.writeFileSync(replacement, JSON.stringify({ ...store.value, defaultLanguage: "en" }));
  fs.renameSync(replacement, store.file);
  assert.equal((await changed)[0].defaultLanguage, "en");
  store.close();
  assert.equal(store.watcher, null);
});
