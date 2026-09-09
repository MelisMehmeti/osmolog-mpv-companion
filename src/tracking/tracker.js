"use strict";

const EventEmitter = require("node:events");
const { clamp, cleanTitle, languageCode, localDateKey, monotonicNow, monotonicSeconds, uuid } = require("../util");
const { resolveLanguage } = require("../language/resolver");

const COUNTING_PROPERTIES = new Set([
  "pause", "core-idle", "paused-for-cache", "mute", "volume", "speed", "focused",
  "idle-active", "eof-reached", "fullscreen", "sub-visibility", "track-list", "aid", "sid"
]);

class TrackingEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.monotonicNow = options.monotonicNow || monotonicNow;
    this.wallNow = options.wallNow || Date.now;
    this.config = options.config;
    this.player = ["mpv", "manatan", "steam"].includes(options.player) ? options.player : "mpv";
    this.resolveLanguage = options.resolveLanguage || resolveLanguage;
    this.properties = {};
    this.fileLoaded = false;
    this.seeking = false;
    this.sessionId = "";
    this.filePath = "";
    this.filename = "";
    this.mediaTitle = "";
    this.language = { languageCode: null, languageSource: "unassigned" };
    this.segment = null;
    this.lastMono = this.monotonicNow();
    this.lastWall = this.wallNow();
    this.sessionCreditedSeconds = 0;
    this.sessionModeSeconds = { active: 0, passive: 0 };
    this.languageOverride = null;
  }

  currentMode() {
    if (this.player === "steam") return this.fileLoaded && this.properties.pause === false && this.language.languageCode
      ? this.properties.focused === true ? "active" : "passive" : null;
    if (!this.fileLoaded || this.seeking || this.properties.pause !== false ||
      this.properties["core-idle"] !== false || this.properties["paused-for-cache"] === true ||
      this.properties.mute === true || Number(this.properties.volume) <= 0 ||
      this.properties["idle-active"] === true || this.properties["eof-reached"] === true) return null;
    return this.properties.focused === true ? "active" : "passive";
  }

  hasVideo() {
    return Array.isArray(this.properties["track-list"]) &&
      this.properties["track-list"].some(track => track?.type === "video");
  }

  audioTrackLanguage() {
    return String(this.properties["current-tracks/audio/lang"] || "").trim().slice(0, 24) || null;
  }

  subTrackLanguage() {
    return String(this.properties["current-tracks/sub/lang"] || "").trim().slice(0, 24) || null;
  }

  snapshot() {
    return {
      connected: true,
      playing: Boolean(this.currentMode()),
      languageCode: this.language.languageCode,
      mode: this.currentMode(),
      title: this.config.recordTitles ? this.title() : undefined,
      sessionSeconds: this.sessionCreditedSeconds,
      sessionActiveSeconds: this.sessionModeSeconds.active,
      sessionPassiveSeconds: this.sessionModeSeconds.passive
    };
  }

  title() {
    return this.player === "steam" ? this.mediaTitle.replace(/[\x00-\x1f]/g, " ").slice(0, 160) : cleanTitle(this.filename, this.mediaTitle);
  }

  updateConfig(config) {
    const before = `${this.language.languageCode}|${this.language.languageSource}`;
    this.advance();
    this.config = config;
    if (this.player === "steam" && !config.recordTitles && this.segment) delete this.segment.title;
    this.language = this.languageOverride || this.resolveLanguage(this.filePath, config);
    const after = `${this.language.languageCode}|${this.language.languageSource}`;
    if (this.fileLoaded && before !== after) this.transition(true);
  }

  setLanguageOverride(value, times = {}) {
    const code = languageCode(value);
    if (!this.fileLoaded || !code) return false;
    this.advance(times);
    const before = `${this.language.languageCode}|${this.language.languageSource}`;
    this.languageOverride = { languageCode: code, languageSource: "app" };
    this.language = this.languageOverride;
    if (before !== `${code}|app`) this.transition(true, times);
    this.emit("state", this.snapshot());
    return true;
  }

  updateProperty(name, value, times = {}) {
    if (!COUNTING_PROPERTIES.has(name) && !name.startsWith("current-tracks/")) return;
    this.advance(times);
    const previousMode = this.currentMode();
    this.properties[name] = value;
    const nextMode = this.currentMode();
    if (previousMode !== nextMode) this.transition(false, times);
    this.emit("state", this.snapshot());
  }

  loadFile(metadata = {}, times = {}) {
    if (this.fileLoaded) this.endFile(times);
    this.advance(times);
    this.fileLoaded = true;
    this.seeking = false;
    this.sessionId = uuid();
    this.filePath = String(metadata.path || "");
    this.filename = String(metadata.filename || "");
    this.mediaTitle = String(metadata.mediaTitle || "");
    Object.assign(this.properties, metadata.properties || {});
    this.language = this.resolveLanguage(this.filePath, this.config);
    this.sessionCreditedSeconds = 0;
    this.sessionModeSeconds = { active: 0, passive: 0 };
    this.languageOverride = null;
    this.lastMono = times.mono ?? this.monotonicNow();
    this.lastWall = times.wall ?? this.wallNow();
    this.transition(false, times);
    this.emit("file-loaded", { ...this.snapshot(), languageSource: this.language.languageSource });
    this.emit("state", this.snapshot());
  }

  beginSeek(times = {}) {
    this.advance(times);
    this.seeking = true;
    this.transition(false, times);
    this.emit("state", this.snapshot());
  }

  playbackRestart(times = {}) {
    this.advance(times);
    this.seeking = false;
    this.transition(false, times);
    this.emit("state", this.snapshot());
  }

  endFile(times = {}) {
    if (!this.fileLoaded) return;
    this.advance(times);
    this.closeSegment(true, times);
    this.fileLoaded = false;
    this.seeking = false;
    this.sessionId = "";
    this.languageOverride = null;
    this.filePath = "";
    this.segment = null;
    this.emit("end-file");
    this.emit("state", { connected: true, playing: false, languageCode: null, mode: null });
  }

  tick(times = {}) {
    this.advance(times);
    const wall = times.wall ?? this.wallNow();
    if (this.segment && (this.segment.localDate !== localDateKey(wall) || this.segment.realSeconds >= 60)) {
      this.closeSegment(false, times);
      this.openSegment(this.currentMode(), times);
    }
    this.emit("tick", this.snapshot());
    this.emit("state", this.snapshot());
  }

  transition(forceBoundary = false, times = {}) {
    const mode = this.currentMode();
    if (this.segment && (forceBoundary || this.segment.mode !== mode)) this.closeSegment(false, times);
    if (!this.segment && mode) this.openSegment(mode, times);
  }

  openSegment(mode, times = {}) {
    if (!mode || !this.fileLoaded) return;
    const wall = times.wall ?? this.wallNow();
    this.segment = {
      eventId: uuid(),
      sessionId: this.sessionId,
      schemaVersion: 1,
      player: this.player,
      ...(this.player === "steam" ? { appId: this.filePath.replace("steam://app/", ""), activity: "gaming" } : {}),
      mode,
      languageCode: this.language.languageCode,
      languageSource: this.language.languageSource,
      audioTrackLang: this.audioTrackLanguage(),
      subTrackLang: this.subTrackLanguage(),
      subsVisible: this.properties["sub-visibility"] === true,
      hasVideo: this.hasVideo(),
      ...(this.config.recordTitles ? { title: this.title() } : {}),
      realSeconds: 0,
      contentSeconds: 0,
      creditedSeconds: 0,
      maxSpeedSeen: Math.max(0, Number(this.properties.speed) || 1),
      segmentStartedAt: wall,
      segmentEndedAt: wall,
      localDate: localDateKey(wall),
      timezoneOffsetMinutes: new Date(wall).getTimezoneOffset(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
  }

  advance(times = {}) {
    const mono = times.mono ?? this.monotonicNow();
    const wall = times.wall ?? this.wallNow();
    const gap = monotonicSeconds(mono, this.lastMono);
    // A suspended game/PC or stalled sampler is not evidence of play. Close at
    // the last observed timestamp; never spread pre-sleep time across the gap.
    if (this.player === "steam" && gap > 5) {
      this.closeSegment(false, times);
      this.lastMono = mono;
      this.lastWall = wall;
      this.openSegment(this.currentMode(), times);
      return;
    }
    const elapsed = Math.min(5, gap);
    if (this.segment && elapsed > 0) {
      const speed = Math.max(0, Number(this.properties.speed) || 1);
      const creditRate = this.player === "steam" ? 1 : clamp(speed, this.config.speedCreditMin, this.config.speedCreditMax);
      this.segment.realSeconds += elapsed;
      this.segment.contentSeconds += elapsed * speed;
      this.segment.creditedSeconds += elapsed * creditRate;
      this.segment.maxSpeedSeen = Math.max(this.segment.maxSpeedSeen, speed);
      this.segment.segmentEndedAt = Math.max(this.segment.segmentStartedAt + 1, wall);
      this.sessionCreditedSeconds += elapsed * creditRate;
      this.sessionModeSeconds[this.segment.mode] += elapsed * creditRate;
      this.emit("checkpoint", this.draft());
    }
    this.lastMono = mono;
    this.lastWall = wall;
  }

  draft() {
    if (!this.segment || this.segment.realSeconds <= 0) return null;
    return this.finalizedSegment(this.segment);
  }

  finalizedSegment(segment) {
    const real = segment.realSeconds;
    return {
      ...segment,
      realSeconds: real,
      contentSeconds: segment.contentSeconds,
      creditedSeconds: segment.creditedSeconds,
      avgSpeed: real > 0 ? segment.contentSeconds / real : 1,
      segmentEndedAt: Math.max(segment.segmentStartedAt + 1, segment.segmentEndedAt)
    };
  }

  closeSegment(final, _times = {}) {
    if (!this.segment) return;
    const completed = this.finalizedSegment(this.segment);
    this.segment = null;
    // The synchronous segment listener persists the journal before its draft
    // is cleared. Every positive fragment is durable, even after a short seek.
    if (completed.realSeconds > 0) this.emit("segment", completed);
    this.emit("checkpoint", null);
  }
}

module.exports = { COUNTING_PROPERTIES, TrackingEngine };
