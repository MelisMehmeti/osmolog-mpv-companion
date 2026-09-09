"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const EventEmitter = require("node:events");
const { languageCode } = require("./util");
const { appId } = require("./steam/library");

function normalizeSteam(raw = {}) {
  const idle = Number(raw.idleSeconds);
  return {
    enabled: raw.enabled === true,
    idleSeconds: Number.isFinite(idle) ? (idle === 0 ? 0 : Math.max(30, Math.min(3600, Math.round(idle)))) : 300,
    games: Object.fromEntries(Object.entries(raw.games || {}).filter(([id]) => appId(id)).slice(0, 10000)
      .map(([id, game]) => [id, { language: languageCode(game?.language) || "", excluded: game?.excluded === true }]))
  };
}

const DEFAULTS = Object.freeze({
  port: 47823,
  extensionId: "PUT_EXTENSION_ID_HERE",
  defaultLanguage: "ja",
  folderRules: [
    { match: "D:\\Media\\Japanese", language: "ja" },
    { match: "D:\\Media\\English", language: "en" }
  ],
  recordTitles: true,
  steam: { enabled: false, idleSeconds: 300, games: {} },
  runOnlyWithMpv: false,
  mpvConfigDirectory: "",
  speedCreditMin: 1,
  speedCreditMax: 2,
  overlay: { toastOnLoad: true, persistent: false }
});

function configDirectory(environment = process.env) {
  return path.join(environment.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Osmolog");
}

function normalize(raw = {}) {
  const minimum = Math.max(0.1, Math.min(10, Number(raw.speedCreditMin) || DEFAULTS.speedCreditMin));
  const maximum = Math.max(minimum, Math.min(10, Number(raw.speedCreditMax) || DEFAULTS.speedCreditMax));
  return {
    port: Math.max(1024, Math.min(65531, Math.trunc(Number(raw.port) || DEFAULTS.port))),
    extensionId: String(raw.extensionId || DEFAULTS.extensionId).trim().slice(0, 128),
    defaultLanguage: languageCode(raw.defaultLanguage),
    folderRules: (Array.isArray(raw.folderRules) ? raw.folderRules : DEFAULTS.folderRules)
      .map(rule => ({ match: String(rule?.match || "").trim(), language: languageCode(rule?.language) }))
      .filter(rule => rule.match && rule.language)
      .slice(0, 100),
    recordTitles: raw.recordTitles !== false,
    steam: normalizeSteam(raw.steam),
    runOnlyWithMpv: raw.runOnlyWithMpv === true,
    mpvConfigDirectory: String(raw.mpvConfigDirectory || "").replace(/[\r\n]/g, "").trim().slice(0, 2048),
    speedCreditMin: minimum,
    speedCreditMax: maximum,
    overlay: {
      toastOnLoad: raw.overlay?.toastOnLoad !== false,
      persistent: raw.overlay?.persistent === true
    }
  };
}

class ConfigStore extends EventEmitter {
  constructor(options = {}) {
    super();
    this.directory = options.directory || configDirectory(options.environment);
    this.file = options.file || path.join(this.directory, "companion.json");
    this.value = normalize(DEFAULTS);
    this.watcher = null;
    this.reloadTimer = null;
  }

  load() {
    fs.mkdirSync(this.directory, { recursive: true });
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, `${JSON.stringify(DEFAULTS, null, 2)}\n`, { flag: "wx" });
    }
    try {
      this.value = normalize(JSON.parse(fs.readFileSync(this.file, "utf8")));
    } catch (error) {
      throw new Error(`Could not read companion.json: ${error.message}`);
    }
    return this.value;
  }

  watch() {
    if (this.watcher) return;
    // Windows temporary directories can use 8.3 aliases (for example RUNNER~1).
    // libuv receives long filenames; watching an alias can abort Node in its
    // relative-path assertion before JavaScript can handle the error.
    const watchDirectory = fs.realpathSync.native(this.directory);
    this.watcher = fs.watch(watchDirectory, (_event, filename) => {
      if (String(filename || "").toLowerCase() !== path.basename(this.file).toLowerCase()) return;
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => {
        try {
          const previous = this.value;
          const next = this.load();
          this.emit("change", next, previous);
        } catch (error) {
          this.emit("warning", error.message);
        }
      }, 150);
    });
  }

  update(patch = {}) {
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(this.file, "utf8")); }
    catch { stored = { ...DEFAULTS }; }
    const merged = {
      ...stored,
      ...patch,
      ...(patch.overlay ? { overlay: { ...(stored.overlay || {}), ...patch.overlay } } : {})
    };
    const previous = this.value;
    fs.writeFileSync(this.file, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    this.value = normalize(merged);
    this.emit("change", this.value, previous);
    return this.value;
  }

  close() {
    clearTimeout(this.reloadTimer);
    this.watcher?.close();
    this.watcher = null;
  }
}

module.exports = { ConfigStore, DEFAULTS, configDirectory, normalize, normalizeSteam };
