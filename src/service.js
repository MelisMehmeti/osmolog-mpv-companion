"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const EventEmitter = require("node:events");
const { ConfigStore } = require("./config");
const { PendingJournal } = require("./journal/journal");
const { MpvIpcClient, PIPE_PATH } = require("./mpv/ipc-client");
const { MpvOverlay } = require("./mpv/overlay");
const { WindowsFocusDetector } = require("./mpv/windows-focus");
const { ManatanMediaSessionSensor } = require("./manatan/media-session-sensor");
const { ManatanTracker } = require("./manatan/tracker");
const { WindowsActivitySensor } = require("./steam/windows-activity");
const { SteamSensor } = require("./steam/sensor");
const { SteamTracker } = require("./steam/tracker");
const { appId } = require("./steam/library");
const { languageCode } = require("./util");
const { TrackingEngine } = require("./tracking/tracker");
const { CompanionTransport, validExtensionId } = require("./transport/websocket-server");
const { WebSocket } = require("ws");

function existingCompanionAt(port, extensionId, timeoutMs = 600) {
  if (!validExtensionId(extensionId)) return Promise.resolve(false);
  return new Promise(resolve => {
    let settled = false;
    let socket;
    const finish = found => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.terminate(); } catch { /* ignored */ }
      resolve(found);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `chrome-extension://${extensionId}` });
      socket.on("message", data => {
        try {
          const message = JSON.parse(String(data));
          if (message.type === "hello" && message.player === "mpv") finish(true);
        } catch { /* ignored */ }
      });
      socket.once("error", () => finish(false));
      socket.once("close", () => finish(false));
    } catch { finish(false); }
  });
}

function mpvConfigContainsPipe(environment = process.env) {
  const appData = environment.APPDATA || "";
  const candidates = [path.join(appData, "mpv", "mpv.conf"), path.join(appData, "mpv.net", "mpv.conf")];
  return candidates.some(file => {
    try { return /(?:^|\r?\n)\s*input-ipc-server\s*=\s*\\\\\.\\pipe\\osmolog-mpv\s*(?:\r?\n|$)/i.test(fs.readFileSync(file, "utf8")); }
    catch { return false; }
  });
}

function warnForMultipleMpvProcesses(logger) {
  if (process.platform !== "win32") return;
  childProcess.execFile("tasklist.exe", ["/FI", "IMAGENAME eq mpv.exe", "/FO", "CSV", "/NH"], { windowsHide: true }, (error, stdout) => {
    if (error) return;
    const count = String(stdout || "").split(/\r?\n/).filter(line => /^"mpv\.exe"/i.test(line)).length;
    if (count > 1) logger.warn("More than one mpv process is running. The fixed pipe can track only one instance.");
  });
}

class CompanionService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.externalLogger = options.logger || null;
    this.dependencies = options.dependencies || {};
    this.logger = {
      info: message => this.log("info", message),
      warn: message => this.log("warn", message),
      error: message => this.log("error", message)
    };
    this.configStore = options.configStore || new ConfigStore(options.configOptions);
    this.config = null;
    this.journal = null;
    this.transport = null;
    this.mpv = null;
    this.tracker = null;
    this.overlay = null;
    this.focus = null;
    this.manatanSensor = null;
    this.manatanTracker = null;
    this.steamSensor = null;
    this.steamTracker = null;
    this.focusTimer = null;
    this.tickTimer = null;
    this.setupTimer = null;
    this.mpvExitTimer = null;
    this.started = false;
    this.shuttingDown = false;
    this.mpvConnected = false;
    this.connectedOnce = false;
    this.mpvConfigDirectory = "";
    this.mpvExitDelayMs = Math.max(250, Number(options.mpvExitDelayMs) || 3000);
    this.deliveryGraceMs = Math.max(0, Number(options.deliveryGraceMs) || 1500);
  }

  log(level, message) {
    this.externalLogger?.[level]?.(message);
    this.emit("log", { level, message: String(message || ""), at: Date.now() });
  }

  publicState() {
    const mpvPlayback = this.tracker?.snapshot?.() || {};
    const manatanPlayback = this.manatanTracker?.snapshot?.() || {};
    const steam = this.steamTracker?.snapshot?.() || {};
    const playback = steam.playing ? steam : manatanPlayback.playing ? manatanPlayback
      : mpvPlayback.playing ? mpvPlayback
        : steam.fileLoaded ? steam : manatanPlayback.fileLoaded ? manatanPlayback : mpvPlayback;
    const player = playback === steam ? "steam" : playback === manatanPlayback ? "manatan" : "mpv";
    const languageCode = playback.languageCode || (player === "steam" ? null : this.config?.defaultLanguage) || null;
    return {
      ready: this.started,
      port: this.transport?.port || this.config?.port || 0,
      mpvConnected: this.mpvConnected,
      manatanConnected: manatanPlayback.connected === true,
      manatanMediaSessionFound: manatanPlayback.mediaSessionFound === true,
      manatanReaderAvailable: manatanPlayback.available === true,
      steam,
      player,
      extensionConnected: (this.transport?.clients?.size || 0) > 0,
      paired: validExtensionId(this.config?.extensionId),
      pairingSeconds: this.transport?.pairingRemaining?.() || 0,
      extensionId: validExtensionId(this.config?.extensionId) ? this.config.extensionId : "",
      pendingSegments: this.journal?.list?.().length || 0,
      runOnlyWithMpv: this.config?.runOnlyWithMpv === true,
      mpvConfigDirectoryDetected: Boolean(this.mpvConfigDirectory || this.config?.mpvConfigDirectory),
      playing: playback.playing === true,
      paused: playback.paused === true || (player === "mpv" && this.tracker?.properties?.pause === true),
      mode: playback.mode || "",
      languageCode,
      title: playback.title || "",
      sessionSeconds: Math.max(0, Number(playback.sessionSeconds) || 0),
      sessionActiveSeconds: Math.max(0, Number(playback.sessionActiveSeconds) || 0),
      sessionPassiveSeconds: Math.max(0, Number(playback.sessionPassiveSeconds) || 0),
      speed: Math.max(0, Number(playback.speed) || Number(this.tracker?.properties?.speed) || 1),
      todaySeconds: Math.max(0, Number(this.overlay?.todayTotals?.get(languageCode)) || 0),
      fileLoaded: playback.fileLoaded === true || (player === "mpv" && this.tracker?.fileLoaded === true),
      fullscreen: player === "mpv" && this.tracker?.properties?.fullscreen === true
    };
  }

  transportState() {
    const state = this.publicState();
    return {
      type: "state",
      player: state.player,
      mpvConnected: state.mpvConnected,
      manatanConnected: state.manatanConnected,
      manatanMediaSessionFound: state.manatanMediaSessionFound,
      manatanReaderAvailable: state.manatanReaderAvailable,
      steam: state.steam,
      playing: state.playing,
      paused: state.paused,
      languageCode: state.languageCode,
      mode: state.mode,
      title: state.title,
      sessionSeconds: state.sessionSeconds,
      sessionActiveSeconds: state.sessionActiveSeconds,
      sessionPassiveSeconds: state.sessionPassiveSeconds,
      speed: state.speed,
      fileLoaded: state.fileLoaded
    };
  }

  broadcastPlaybackState() {
    this.transport?.broadcast?.(this.transportState());
    this.publish();
  }

  publish() {
    this.emit("state", this.publicState());
  }

  async start() {
    if (this.started) return this;
    this.config = this.configStore.load();
    this.configStore.watch();
    this.configStore.on("warning", message => this.logger.warn(message));
    if (await existingCompanionAt(this.config.port, this.config.extensionId)) {
      throw new Error("Another Osmolog companion is already running. Close the older PowerShell companion, then restart this app.");
    }

    this.journal = new PendingJournal({
      file: path.join(this.configStore.directory, "pending.jsonl"),
      onWarning: message => this.logger.warn(message)
    });
    this.journal.open();
    const recoveredDrafts = this.journal.consumeDrafts();
    for (const recoveredDraft of recoveredDrafts) {
      if (!recoveredDraft?.eventId || Number(recoveredDraft.realSeconds) <= 0) continue;
      this.journal.append(recoveredDraft);
      this.journal.clearDraft(recoveredDraft.player || "mpv");
      this.logger.info(`Recovered an interrupted ${recoveredDraft.player || "mpv"} segment.`);
    }

    this.transport = new CompanionTransport({ port: this.config.port, extensionId: this.config.extensionId, logger: this.logger });
    this.transport.on("warning", message => this.logger.warn(message));
    this.transport.on("client-count", () => this.publish());
    this.transport.on("pairing", () => this.publish());
    this.transport.on("paired", extensionId => {
      this.config = this.configStore.update({ extensionId });
      this.logger.info("Paired with the Osmolog Chrome extension.");
      this.publish();
    });
    const selectedPort = await this.transport.start();
    this.logger.info(`Listening for the Osmolog extension on 127.0.0.1:${selectedPort}.`);
    if (!validExtensionId(this.config.extensionId)) {
      this.transport.startPairing(5 * 60 * 1000);
      this.logger.info("Waiting for the Osmolog dashboard to complete automatic first-run pairing.");
    }

    this.mpv = this.dependencies.mpv || new MpvIpcClient({ pipePath: PIPE_PATH, logger: this.logger });
    this.tracker = new TrackingEngine({ config: this.config });
    this.overlay = new MpvOverlay(this.mpv, { config: this.config, logger: this.logger });
    this.focus = this.dependencies.focus || new WindowsFocusDetector({ logger: this.logger });
    this.manatanSensor = this.dependencies.manatanSensor || new ManatanMediaSessionSensor({ logger: this.logger });
    this.manatanTracker = new ManatanTracker({ config: this.config, focus: this.focus });
    this.steamSensor = this.dependencies.steamSensor || new SteamSensor({ focus: this.focus, activity: new WindowsActivitySensor({ focus: this.focus, logger: this.logger }) });
    this.steamTracker = new SteamTracker({ config: this.config, sensor: this.steamSensor });

    const deliver = event => {
      this.journal.append(event);
      this.transport.broadcast({ type: "segment", ...event });
      this.publish();
    };
    this.tracker.on("segment", deliver);
    this.tracker.on("checkpoint", draft => draft ? this.journal.saveDraft(draft) : this.journal.clearDraft("mpv"));
    this.tracker.on("state", () => this.broadcastPlaybackState());
    this.tracker.on("file-loaded", state => {
      void this.overlay.toast(state);
      void this.overlay.render(state);
      this.publish();
    });
    this.tracker.on("tick", state => void this.overlay.render(state));
    this.tracker.on("end-file", () => {
      void this.overlay.remove();
      this.publish();
    });
    this.manatanTracker.on("segment", deliver);
    this.manatanTracker.on("checkpoint", draft => draft ? this.journal.saveDraft(draft) : this.journal.clearDraft("manatan"));
    this.manatanTracker.on("state", () => this.broadcastPlaybackState());
    this.manatanTracker.on("connection", () => this.broadcastPlaybackState());
    this.manatanSensor.on("state", state => this.manatanTracker.updateSensor(state));
    this.steamTracker.on("segment", deliver);
    this.steamTracker.on("checkpoint", draft => draft ? this.journal.saveDraft(draft) : this.journal.clearDraft("steam"));
    this.steamTracker.on("connection", () => this.broadcastPlaybackState());

    this.transport.on("client", socket => {
      for (const event of this.journal.list()) this.transport.send(socket, { type: "segment", ...event });
      this.transport.send(socket, this.transportState());
      this.publish();
    });
    this.transport.on("message", (message, socket) => {
      if (message?.type === "steamControl" && /^[a-z0-9-]{1,80}$/i.test(String(message.requestId || ""))) {
        let result;
        try { result = this.configureSteam(message.patch); }
        catch { result = { ok: false, message: "Could not save Steam settings. Try again." }; }
        this.transport.send(socket, { type: "steamControlResult", requestId: message.requestId, ok: result.ok === true, message: result.message || "" });
      }
      if (message?.type === "ack" && this.journal.acknowledge(String(message.eventId || ""))) {
        this.transport.send(socket, { type: "acknowledged", eventId: message.eventId });
      }
      if (message?.type === "todayTotals") {
        this.overlay.setTodayTotal(message.languageCode, message.seconds);
        this.publish();
      }
    });

    this.mpv.on("connected", () => {
      clearTimeout(this.mpvExitTimer);
      this.mpvExitTimer = null;
      this.mpvConnected = true;
      this.connectedOnce = true;
      this.logger.info("Connected to mpv.");
      warnForMultipleMpvProcesses(this.logger);
      void this.overlay.installToggle().catch(error => this.logger.warn(`Could not register Shift+O: ${error.message}`));
      this.publish();
    });
    this.mpv.on("executable-directory", directory => this.emit("mpv-executable-directory", directory));
    this.mpv.on("config-directory", directory => {
      this.mpvConfigDirectory = String(directory || "").trim();
      this.emit("mpv-config-directory", this.mpvConfigDirectory);
      this.publish();
    });
    this.mpv.on("disconnected", () => {
      this.mpvConnected = false;
      this.logger.info("mpv disconnected; waiting for it to return.");
      this.tracker.endFile();
      this.broadcastPlaybackState();
      this.publish();
      if (this.connectedOnce && this.config?.runOnlyWithMpv === true) this.scheduleExitAfterMpv();
    });
    this.mpv.on("connection-error", error => {
      if (this.connectedOnce && !["ENOENT", "ECONNREFUSED"].includes(error.code)) this.logger.warn(`mpv connection failed: ${error.message}`);
    });
    this.mpv.on("protocol-warning", message => this.logger.warn(message));
    this.mpv.on("focus-support", supported => {
      clearInterval(this.focusTimer);
      this.focusTimer = null;
      if (supported) {
        this.logger.info("Using mpv's focused property for active/passive tracking.");
        return;
      }
      this.logger.info("mpv focused is unavailable; using the Windows foreground-window fallback.");
      this.tracker.updateProperty("focused", this.focus.isMpvFocused());
      this.focusTimer = setInterval(() => this.tracker.updateProperty("focused", this.focus.isMpvFocused()), 2000);
    });
    this.mpv.on("property", (name, value) => this.tracker.updateProperty(name, value));
    this.mpv.on("file-loaded", snapshot => this.tracker.loadFile(snapshot));
    this.mpv.on("seek", () => this.tracker.beginSeek());
    this.mpv.on("playback-restart", () => this.tracker.playbackRestart());
    this.mpv.on("end-file", () => this.tracker.endFile());
    this.mpv.on("shutdown", () => this.tracker.endFile());
    this.mpv.on("client-message", message => this.overlay.handleClientMessage(message));

    this.configStore.on("change", next => {
      const portChanged = this.config && next.port !== this.config.port;
      this.config = next;
      this.transport.updateExtensionId(next.extensionId);
      this.tracker.updateConfig(next);
      this.manatanTracker.updateConfig(next);
      this.steamTracker.updateConfig(next);
      this.overlay.updateConfig(next);
      if (portChanged) this.logger.warn("Port changes take effect after restarting the companion.");
      this.publish();
    });

    this.mpv.start();
    this.manatanSensor.start();
    this.steamSensor.setEnabled(this.config.steam.enabled);
    this.tickTimer = setInterval(() => {
      this.tracker.tick();
      this.manatanTracker.tick();
      this.steamTracker.tick();
      this.publish();
    }, 1000);
    this.setupTimer = setTimeout(() => {
      if (this.mpv.connected || this.config?.steam?.enabled) return;
      const line = "input-ipc-server=\\\\.\\pipe\\osmolog-mpv";
      this.logger.warn(mpvConfigContainsPipe()
        ? "The mpv IPC setting is present, but the named pipe is unavailable. Restart mpv and make sure another instance is not already using the pipe."
        : `mpv was not found. Add this exact line to mpv.conf, then restart mpv:\n${line}`);
      this.publish();
    }, 10000);
    this.setupTimer.unref?.();
    this.started = true;
    this.publish();
    return this;
  }

  startPairing() {
    this.transport.startPairing(60000);
    this.publish();
    return this.publicState();
  }

  setExtensionId(extensionId) {
    if (!validExtensionId(extensionId)) return { ok: false, message: "Enter the 32-character Chrome extension ID." };
    this.config = this.configStore.update({ extensionId: String(extensionId).toLowerCase() });
    this.transport.updateExtensionId(this.config.extensionId);
    this.publish();
    return { ok: true, state: this.publicState() };
  }

  setLanguage(languageCode) {
    if (this.publicState().player === "steam" && this.steamTracker?.game) {
      const result = this.configureSteam({ appId: this.steamTracker.game.appId, language: languageCode });
      return { ...result, scope: "game", state: this.publicState() };
    }
    const changedCurrentFile = this.tracker.setLanguageOverride(languageCode) ||
      this.manatanTracker?.engine?.setLanguageOverride?.(languageCode) === true;
    this.config = this.configStore.update({ defaultLanguage: languageCode });
    this.publish();
    return { ok: true, scope: changedCurrentFile ? "file-and-default" : "default", state: this.publicState() };
  }

  configureSteam(patch = {}) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, message: "Invalid Steam settings." };
    const previous = this.config.steam || { enabled: false, idleSeconds: 300, games: {} };
    const next = { ...previous, games: { ...previous.games } };
    if ("enabled" in patch) {
      if (typeof patch.enabled !== "boolean") return { ok: false, message: "Invalid tracking setting." };
      next.enabled = patch.enabled;
    }
    if ("idleSeconds" in patch) {
      if (!Number.isInteger(patch.idleSeconds) || (patch.idleSeconds !== 0 && (patch.idleSeconds < 30 || patch.idleSeconds > 3600)))
        return { ok: false, message: "Choose an idle limit between 30 seconds and 60 minutes, or turn it off." };
      next.idleSeconds = patch.idleSeconds;
    }
    if ("language" in patch || "excluded" in patch) {
      const id = appId(patch.appId);
      if (!id || id !== this.steamTracker?.game?.appId) return { ok: false, message: "That game is no longer selected. Refresh and try again." };
      const game = { ...next.games[id] };
      if ("language" in patch) {
        if (patch.language !== "" && !languageCode(patch.language)) return { ok: false, message: "Choose a valid game language." };
        game.language = languageCode(patch.language) || "";
      }
      if ("excluded" in patch) {
        if (typeof patch.excluded !== "boolean") return { ok: false, message: "Invalid game setting." };
        game.excluded = patch.excluded;
      }
      next.games[id] = game;
    }
    if ("paused" in patch && (typeof patch.paused !== "boolean" || patch.appId !== this.steamTracker?.game?.appId))
      return { ok: false, message: "That game is no longer selected. Refresh and try again." };
    if (Object.keys(patch).some(key => !["paused", "appId"].includes(key))) this.config = this.configStore.update({ steam: next });
    if ("paused" in patch) this.steamTracker?.setPaused(patch.paused);
    this.broadcastPlaybackState();
    return { ok: true, state: this.publicState() };
  }

  setRunOnlyWithMpv(enabled, mpvConfigDirectory = "") {
    this.config = this.configStore.update({
      runOnlyWithMpv: enabled === true,
      mpvConfigDirectory: String(mpvConfigDirectory || this.mpvConfigDirectory || this.config?.mpvConfigDirectory || "").trim()
    });
    if (!this.config.runOnlyWithMpv) {
      clearTimeout(this.mpvExitTimer);
      this.mpvExitTimer = null;
    }
    this.publish();
    return this.publicState();
  }

  syncPending() {
    const pending = this.journal?.list?.() || [];
    let sent = 0;
    for (const event of pending) sent += this.transport?.broadcast?.({ type: "segment", ...event }) || 0;
    this.publish();
    return {
      ok: (this.transport?.clients?.size || 0) > 0,
      connected: (this.transport?.clients?.size || 0) > 0,
      pending: pending.length,
      transmissions: sent
    };
  }

  scheduleExitAfterMpv() {
    if (this.mpvExitTimer || this.shuttingDown) return;
    this.mpvExitTimer = setTimeout(async () => {
      this.mpvExitTimer = null;
      if (this.mpvConnected || this.manatanTracker?.snapshot?.().connected || this.config?.steam?.enabled || this.shuttingDown || this.config?.runOnlyWithMpv !== true) return;
      const deadline = Date.now() + this.deliveryGraceMs;
      while ((this.transport?.clients?.size || 0) > 0 && (this.journal?.list?.().length || 0) > 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!this.mpvConnected && !this.manatanTracker?.snapshot?.().connected && !this.config?.steam?.enabled && !this.shuttingDown && this.config?.runOnlyWithMpv === true) {
        this.emit("exit-requested", "mpv closed");
      }
    }, this.mpvExitDelayMs);
    this.mpvExitTimer.unref?.();
  }

  dashboardUrl(view = "settings") {
    if (!validExtensionId(this.config?.extensionId)) return "";
    const safeView = ["overview", "settings"].includes(view) ? view : "settings";
    return `chrome-extension://${this.config.extensionId}/store-assets/dashboard.html?view=${safeView}`;
  }

  openDashboard(view = "settings") {
    return this.transport.broadcast({ type: "openDashboard", view }) > 0;
  }

  async shutdown(reason = "quit") {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.logger.info(`Stopping after ${reason}.`);
    clearInterval(this.tickTimer);
    clearInterval(this.focusTimer);
    clearTimeout(this.setupTimer);
    clearTimeout(this.mpvExitTimer);
    this.tracker?.endFile();
    this.manatanTracker?.end();
    this.manatanSensor?.stop();
    this.steamTracker?.end();
    this.steamSensor?.stop();
    await this.overlay?.remove();
    this.mpv?.stop();
    this.configStore.close();
    await this.transport?.close();
    this.started = false;
  }
}

module.exports = { CompanionService, existingCompanionAt, mpvConfigContainsPipe, warnForMultipleMpvProcesses };
