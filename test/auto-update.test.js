"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const {
  createAutoUpdateController,
  isPortableBuild,
  shouldEnableAutoUpdates
} = require("../src/app/auto-update");

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checks = 0;
  }

  async checkForUpdates() {
    this.checks += 1;
    this.emit("checking-for-update");
  }
}

test("automatic updates run only for the packaged Windows installer", () => {
  const app = { isPackaged: true };
  assert.equal(isPortableBuild({ PORTABLE_EXECUTABLE_FILE: "C:\\Apps\\Osmolog.exe" }), true);
  assert.equal(isPortableBuild({}), false);
  assert.equal(shouldEnableAutoUpdates({ app, platform: "win32", environment: {} }), true);
  assert.equal(shouldEnableAutoUpdates({ app, platform: "win32", environment: { PORTABLE_EXECUTABLE_FILE: "Osmolog.exe" } }), false);
  assert.equal(shouldEnableAutoUpdates({ app, platform: "linux", environment: {} }), false);
  assert.equal(shouldEnableAutoUpdates({ app: { isPackaged: false }, platform: "win32", environment: {} }), false);
});

test("installed builds check on startup and periodically, then install on normal exit", async () => {
  const updater = new FakeUpdater();
  const statuses = [];
  const timeouts = [];
  const intervals = [];
  const controller = createAutoUpdateController({
    app: { isPackaged: true },
    updater,
    platform: "win32",
    environment: {},
    onStatus: status => statuses.push(status),
    setTimeout: callback => { timeouts.push(callback); return { unref() {} }; },
    setInterval: callback => { intervals.push(callback); return { unref() {} }; },
    clearTimeout() {},
    clearInterval() {}
  });

  assert.equal(controller.start(), true);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(timeouts.length, 1);
  assert.equal(intervals.length, 1);

  await timeouts[0]();
  await intervals[0]();
  assert.equal(updater.checks, 2);
  updater.emit("update-available", { version: "1.2.0" });
  updater.emit("update-downloaded", { version: "1.2.0" });
  assert.deepEqual(statuses.slice(-2), [
    { state: "downloading", version: "1.2.0" },
    { state: "ready", version: "1.2.0" }
  ]);
});

test("portable builds stay manual-update only", () => {
  const updater = new FakeUpdater();
  const statuses = [];
  const controller = createAutoUpdateController({
    app: { isPackaged: true },
    updater,
    platform: "win32",
    environment: { PORTABLE_EXECUTABLE_FILE: "C:\\Apps\\Osmolog.exe" },
    onStatus: status => statuses.push(status)
  });

  assert.equal(controller.start(), false);
  assert.deepEqual(statuses, [{ state: "portable" }]);
  assert.equal(updater.checks, 0);
});

test("restart waits for activity to save, prevents duplicate installs, and reopens after installation", async () => {
  const updater = new FakeUpdater();
  const statuses = [], installed = [];
  let finishSaving;
  const saved = new Promise(resolve => { finishSaving = resolve; });
  updater.quitAndInstall = (...args) => installed.push(args);
  const controller = createAutoUpdateController({ app: { isPackaged: true }, platform: "win32", environment: {}, updater,
    beforeInstall: () => saved, onStatus: value => statuses.push(value) });
  controller.start();
  assert.equal((await controller.restartAndInstall()).ok, false);
  updater.emit("update-available", { version: "1.3.0" });
  updater.emit("download-progress", { percent: 42.4 });
  assert.deepEqual(statuses.at(-1), { state: "downloading", version: "1.3.0", percent: 42 });
  updater.emit("update-downloaded", { version: "1.3.0" });
  assert.equal(await controller.check(), false, "a periodic check must not hide the restart action");
  const installation = controller.restartAndInstall();
  assert.equal(statuses.at(-1).state, "preparing");
  assert.deepEqual(installed, [], "the installer cannot run before saving finishes");
  assert.equal((await controller.restartAndInstall()).ok, false);
  finishSaving();
  assert.equal((await installation).ok, true);
  assert.equal(statuses.at(-1).state, "installing");
  assert.deepEqual(installed, [[false, true]]);
  assert.equal(updater.autoRunAppAfterInstall, true);
  controller.stop();
});

test("a failed save prevents installation and a synchronous installer error is not reported as success", async () => {
  for (const failSaving of [true, false]) {
    const updater = new FakeUpdater();
    const statuses = [];
    let calls = 0;
    updater.quitAndInstall = () => { calls++; updater.emit("error", new Error("Installer unavailable")); };
    const controller = createAutoUpdateController({ app: { isPackaged: true }, platform: "win32", environment: {}, updater,
      logger: { warn() {}, info() {} }, beforeInstall: async () => { if (failSaving) throw new Error("Journal unavailable"); },
      onStatus: value => statuses.push(value) });
    controller.start();
    updater.emit("update-downloaded", { version: "1.3.0" });
    assert.equal((await controller.restartAndInstall()).ok, false);
    assert.equal(calls, failSaving ? 0 : 1);
    assert.equal(statuses.at(-1).state, "error");
    controller.stop();
  }
});
