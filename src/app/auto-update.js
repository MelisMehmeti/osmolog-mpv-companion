"use strict";

const STARTUP_CHECK_DELAY_MS = 10_000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function isPortableBuild(environment = process.env) {
  return Boolean(String(environment.PORTABLE_EXECUTABLE_FILE || "").trim());
}

function shouldEnableAutoUpdates(options = {}) {
  const platform = options.platform || process.platform;
  const app = options.app;
  return platform === "win32" && app?.isPackaged === true && !isPortableBuild(options.environment);
}

function createAutoUpdateController(options = {}) {
  const app = options.app;
  const updater = options.updater;
  const logger = options.logger || console;
  const onStatus = typeof options.onStatus === "function" ? options.onStatus : () => {};
  const scheduleTimeout = options.setTimeout || setTimeout;
  const scheduleInterval = options.setInterval || setInterval;
  const cancelTimeout = options.clearTimeout || clearTimeout;
  const cancelInterval = options.clearInterval || clearInterval;
  const startupDelayMs = Math.max(0, Number(options.startupDelayMs) || STARTUP_CHECK_DELAY_MS);
  const intervalMs = Math.max(60_000, Number(options.intervalMs) || UPDATE_CHECK_INTERVAL_MS);
  let startupTimer = null;
  let intervalTimer = null;
  let checking = false;
  let started = false;
  let status = { state: "disabled" };
  let installing = false;

  const publish = (state, details = {}) => { status = { state, ...details }; onStatus(status); };

  async function check() {
    if (!started || checking || installing || status.state === "ready") return false;
    checking = true;
    try {
      await updater.checkForUpdates();
      return true;
    } catch (error) {
      const message = String(error?.message || error || "Update check failed.");
      logger.warn?.(`Automatic update check failed: ${message}`);
      publish("error", { message });
      return false;
    } finally {
      checking = false;
    }
  }

  function start() {
    if (started) return true;
    if (!shouldEnableAutoUpdates({ app, environment: options.environment, platform: options.platform })) {
      publish(isPortableBuild(options.environment) ? "portable" : "disabled");
      return false;
    }
    if (!updater || typeof updater.checkForUpdates !== "function") {
      publish("error", { message: "The automatic updater is unavailable." });
      return false;
    }

    started = true;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.autoRunAppAfterInstall = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on("checking-for-update", () => publish("checking"));
    updater.on("update-available", info => publish("downloading", { version: String(info?.version || "") }));
    updater.on("download-progress", progress => {
      if (status.state !== "downloading") return;
      const percent = Number(progress?.percent);
      publish("downloading", { version: status.version, ...(Number.isFinite(percent) ? { percent: Math.max(0, Math.min(100, Math.round(percent))) } : {}) });
    });
    updater.on("update-not-available", () => publish("current"));
    updater.on("update-downloaded", info => {
      const version = String(info?.version || "");
      logger.info?.(`Companion ${version || "update"} downloaded; it will install after exit.`);
      publish("ready", { version });
    });
    updater.on("error", error => {
      const message = String(error?.message || error || "Update check failed.");
      logger.warn?.(`Automatic updater error: ${message}`);
      publish("error", { message });
    });
    publish("idle");

    startupTimer = scheduleTimeout(() => void check(), startupDelayMs);
    startupTimer?.unref?.();
    intervalTimer = scheduleInterval(() => void check(), intervalMs);
    intervalTimer?.unref?.();
    return true;
  }

  function stop() {
    started = false;
    if (startupTimer) cancelTimeout(startupTimer);
    if (intervalTimer) cancelInterval(intervalTimer);
    startupTimer = null;
    intervalTimer = null;
  }

  async function restartAndInstall() {
    if (!started || installing || status.state !== "ready") return { ok: false, message: "No downloaded update is ready to install." };
    installing = true;
    const version = status.version;
    publish("preparing", { version });
    try {
      await options.beforeInstall?.();
      publish("installing", { version });
      // Show the installer and reopen Companion after it finishes.
      updater.quitAndInstall(false, true);
      if (status.state === "error") return { ok: false, message: "Could not start the installer. Restart Companion and try again." };
      stop();
      return { ok: true };
    } catch (error) {
      logger.warn?.(`Could not install update: ${String(error?.message || error)}`);
      publish("error", { message: "Could not prepare the update. Restart Companion and try again." });
      return { ok: false, message: status.message };
    } finally { installing = false; }
  }

  return Object.freeze({ check, start, stop, restartAndInstall });
}

module.exports = {
  STARTUP_CHECK_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  createAutoUpdateController,
  isPortableBuild,
  shouldEnableAutoUpdates
};
