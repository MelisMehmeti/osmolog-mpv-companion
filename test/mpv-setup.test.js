"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PIPE_SETTING, resolveMpvConfigDirectory, setupMpvConnection } = require("../src/mpv/setup");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "osmolog-mpv-setup-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("setup creates the connection once, without duplicate settings or unnecessary backups", t => {
  const directory = fixture(t), options = { configDirectory: directory };
  assert.equal(setupMpvConnection(options).ok, true);
  assert.equal(fs.readFileSync(path.join(directory, "mpv.conf"), "utf8"), PIPE_SETTING + "\n");
  assert.equal(setupMpvConnection(options).changed, false);
  assert.deepEqual(fs.readdirSync(directory), ["mpv.conf"]);
});

test("setup preserves other settings and profiles, replaces the old pipe, and backs up exact bytes", t => {
  const directory = fixture(t), file = path.join(directory, "mpv.conf");
  const original = Buffer.from("\uFEFF# My settings\r\nvolume=45\r\ninput-ipc-server=old-pipe\r\n[cinema]\r\nfullscreen=yes\r\n");
  fs.writeFileSync(file, original);
  const result = setupMpvConnection({ configDirectory: directory });
  assert.equal(result.ok, true);
  assert.deepEqual(fs.readFileSync(result.backup), original);
  assert.equal(fs.readFileSync(file, "utf8"), "\uFEFF" + PIPE_SETTING + "\r\n# My settings\r\nvolume=45\r\n[cinema]\r\nfullscreen=yes\r\n");
});

test("profile-controlled IPC and unsupported encoding leave configuration untouched", t => {
  const directory = fixture(t), file = path.join(directory, "mpv.conf");
  for (const original of [Buffer.from("[special]\ninput-ipc-server=custom\n"), Buffer.from("volume=25", "utf16le")]) {
    fs.writeFileSync(file, original);
    assert.equal(setupMpvConnection({ configDirectory: directory }).ok, false);
    assert.deepEqual(fs.readFileSync(file), original);
    assert.deepEqual(fs.readdirSync(directory), ["mpv.conf"]);
  }
});

test("setup selects detected, portable and standard configurations without assuming an unrelated executable is MPV", t => {
  const directory = fixture(t), executable = path.join(directory, "mpv.exe"), environment = { APPDATA: path.join(directory, "roaming") };
  assert.equal(resolveMpvConfigDirectory({ executable, environment }), path.join(environment.APPDATA, "mpv"));
  assert.equal(resolveMpvConfigDirectory({ executable: path.join(directory, "mpv.net.exe"), environment }), path.join(environment.APPDATA, "mpv.net"));
  const portable = path.join(directory, "portable_config"); fs.mkdirSync(portable);
  assert.equal(resolveMpvConfigDirectory({ executable, environment }), portable);
  assert.equal(resolveMpvConfigDirectory({ configDirectory: directory, executable, environment }), directory);
  assert.equal(resolveMpvConfigDirectory({ executable: path.join(directory, "other.exe"), environment }), "");
});
