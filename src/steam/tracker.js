"use strict";

const EventEmitter = require("node:events");
const { TrackingEngine } = require("../tracking/tracker");

class SteamTracker extends EventEmitter {
  constructor(options = {}) {
    super();
    this.config = options.config;
    this.sensor = options.sensor;
    this.sensorState = {};
    this.game = null;
    this.manualPaused = false;
    this.engine = new TrackingEngine({ ...options, player: "steam", resolveLanguage: () => this.resolveLanguage() });
    for (const event of ["segment", "checkpoint", "state", "tick", "end-file"])
      this.engine.on(event, value => this.emit(event, value));
  }

  resolveLanguage() {
    const override = this.config?.steam?.games?.[this.game?.appId]?.language;
    return { languageCode: override || this.game?.configuredLanguage || null,
      languageSource: override ? "game-override" : this.game?.configuredLanguage ? "steam-config" : "unassigned" };
  }

  reason() {
    if (!this.config?.steam?.enabled) return "disabled";
    if (!this.sensorState.available) return "unavailable";
    if (!this.sensorState.installed) return "steam-not-found";
    if (!this.game) return "waiting";
    if (this.config.steam.games?.[this.game.appId]?.excluded) return "excluded";
    if (this.manualPaused) return "manual-pause";
    if (!this.resolveLanguage().languageCode) return "language-required";
    const idle = this.sensorState.idleSeconds;
    if (this.config.steam.idleSeconds > 0 && (!Number.isFinite(idle) || idle >= this.config.steam.idleSeconds)) return "idle";
    return this.sensorState.focused ? "tracking" : "tracking-passive";
  }

  updateConfig(config) {
    this.config = config;
    this.sensor?.setEnabled(config?.steam?.enabled === true);
    this.engine.updateConfig(config);
    this.updateSensor(this.sensor?.sample() || this.sensorState);
  }

  setPaused(paused) {
    this.manualPaused = paused === true;
    this.applyState();
    return this.snapshot();
  }

  updateSensor(sample = {}, times = {}) {
    // Finalize the previous game using its previous language and identity.
    const nextGame = this.config?.steam?.enabled ? sample.game : null;
    if (this.game?.appId !== nextGame?.appId) {
      this.engine.endFile(times);
      this.manualPaused = false;
    }
    this.sensorState = sample;
    this.game = nextGame || null;
    if (this.game && !this.engine.fileLoaded) {
      this.engine.loadFile({ path: `steam://app/${this.game.appId}`, mediaTitle: this.game.title,
        properties: { pause: true, focused: false, speed: 1 } }, times);
    }
    const language = this.resolveLanguage();
    if (this.engine.fileLoaded && (language.languageCode !== this.engine.language.languageCode || language.languageSource !== this.engine.language.languageSource))
      this.engine.updateConfig(this.config);
    this.applyState(times);
  }

  applyState(times = {}) {
    if (this.engine.fileLoaded) {
      // Stop before changing focus, and resume only after focus is current.
      // This avoids creating a tiny passive segment when a focused game starts.
      const counting = ["tracking", "tracking-passive"].includes(this.reason());
      if (!counting) this.engine.updateProperty("pause", true, times);
      this.engine.updateProperty("focused", this.sensorState.focused === true, times);
      if (counting) this.engine.updateProperty("pause", false, times);
    }
    this.emit("connection", this.snapshot());
  }

  tick(times = {}) {
    if (this.sensor) this.updateSensor(this.sensor.sample(), times);
    this.engine.tick(times);
  }

  snapshot() {
    const playback = this.engine.snapshot();
    return { ...playback, enabled: this.config?.steam?.enabled === true, available: this.sensorState.available === true,
      installed: this.sensorState.installed === true, connected: Boolean(this.game), appId: this.game?.appId || "",
      title: this.config?.recordTitles ? this.game?.title || "" : "",
      languageCode: this.game ? this.resolveLanguage().languageCode || "" : "",
      languageSource: this.game ? this.resolveLanguage().languageSource : "unassigned",
      languageOverride: this.config?.steam?.games?.[this.game?.appId]?.language || "",
      configuredLanguage: this.game?.configuredLanguage || "", excluded: this.config?.steam?.games?.[this.game?.appId]?.excluded === true,
      reason: this.reason(), manualPaused: this.manualPaused, paused: !["tracking", "tracking-passive"].includes(this.reason()),
      idleSeconds: Number.isFinite(this.sensorState.idleSeconds) ? Math.floor(this.sensorState.idleSeconds) : null,
      idleThresholdSeconds: this.config?.steam?.idleSeconds ?? 300,
      controllerSupported: this.sensorState.controllerSupported === true, fileLoaded: this.engine.fileLoaded,
      speed: 1, error: this.sensorState.error || "" };
  }

  end() { this.engine.endFile(); this.game = null; }
}

module.exports = { SteamTracker };
