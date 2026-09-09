"use strict";

const EventEmitter = require("node:events");
const { TrackingEngine } = require("../tracking/tracker");

function manatanTitle(state = {}) {
  const pieces = [state.title, state.subtitle].map(value => String(value || "").trim()).filter(Boolean);
  return pieces.join(" · ").slice(0, 240) || "Manatan video";
}

class ManatanTracker extends EventEmitter {
  constructor(options = {}) {
    super();
    this.config = options.config;
    this.focus = options.focus;
    this.engine = options.engine || new TrackingEngine({
      config: this.config,
      player: "manatan",
      resolveLanguage: (_path, config) => ({
        languageCode: config?.playerLanguages?.manatan || config?.defaultLanguage || "ja",
        languageSource: config?.defaultLanguage ? "default" : "unassigned"
      })
    });
    this.sensorState = { available: false, appRunning: false, found: false, playing: false };
    this.mediaKey = "";
    for (const event of ["segment", "checkpoint", "state", "file-loaded", "tick", "end-file"])
      this.engine.on(event, value => this.emit(event, value));
  }

  updateConfig(config) {
    this.config = config;
    this.engine.updateConfig(config);
  }

  updateSensor(next = {}) {
    this.sensorState = { ...this.sensorState, ...next };
    const title = manatanTitle(this.sensorState);
    const nextKey = this.sensorState.found ? `${this.sensorState.source || "manatan"}|${title}` : "";
    if (nextKey && nextKey !== this.mediaKey) {
      if (this.engine.fileLoaded) this.engine.endFile();
      this.mediaKey = nextKey;
      this.engine.loadFile({
        path: `manatan://${encodeURIComponent(title)}`,
        filename: title,
        mediaTitle: title,
        properties: {
          pause: !this.sensorState.playing,
          "core-idle": false,
          "paused-for-cache": false,
          mute: this.sensorState.muted === true,
          volume: Number.isFinite(Number(this.sensorState.volume)) ? Number(this.sensorState.volume) : 100,
          speed: this.sensorState.playbackRate || 1,
          focused: this.isFocused(),
          "idle-active": false,
          "eof-reached": false,
          "sub-visibility": true,
          "current-tracks/audio/lang": "jpn",
          "track-list": [{ type: "video" }, { type: "audio" }]
        }
      });
    }
    if (this.engine.fileLoaded) {
      this.engine.updateProperty("speed", this.sensorState.playbackRate || 1);
      this.engine.updateProperty("focused", this.isFocused());
      this.engine.updateProperty("mute", this.sensorState.muted === true);
      this.engine.updateProperty("volume", Number.isFinite(Number(this.sensorState.volume)) ? Number(this.sensorState.volume) : 100);
      this.engine.updateProperty("pause", !this.sensorState.playing);
      if (!this.sensorState.found && !this.sensorState.appRunning) {
        this.engine.endFile();
        this.mediaKey = "";
      }
    }
    this.emit("connection", this.snapshot());
  }

  isFocused() {
    return this.focus?.isProcessFocused?.(["manatan.exe"]) === true;
  }

  tick() {
    if (this.engine.fileLoaded) {
      this.engine.updateProperty("focused", this.isFocused());
      this.engine.tick();
    }
    this.emit("connection", this.snapshot());
  }

  snapshot() {
    const playback = this.engine.snapshot();
    return {
      sessionId: playback.sessionId,
      manualPaused: playback.manualPaused,
      muted: playback.muted,
      available: this.sensorState.available === true,
      connected: this.sensorState.appRunning === true,
      mediaSessionFound: this.sensorState.found === true,
      playing: playback.playing === true,
      mode: playback.mode || "",
      languageCode: playback.languageCode || this.config?.defaultLanguage || "ja",
      title: playback.title || "",
      sessionSeconds: Math.max(0, Number(playback.sessionSeconds) || 0),
      sessionActiveSeconds: Math.max(0, Number(playback.sessionActiveSeconds) || 0),
      sessionPassiveSeconds: Math.max(0, Number(playback.sessionPassiveSeconds) || 0),
      speed: Math.max(0.1, Number(this.engine.properties.speed) || 1),
      fileLoaded: this.engine.fileLoaded === true,
      paused: this.engine.properties.pause === true,
      error: this.sensorState.error || ""
    };
  }

  end() {
    this.engine.endFile();
    this.mediaKey = "";
  }
}

module.exports = { ManatanTracker, manatanTitle };
