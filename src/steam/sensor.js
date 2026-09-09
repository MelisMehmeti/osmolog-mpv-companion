"use strict";

const EventEmitter = require("node:events");
const path = require("node:path");
const { containsPath, discoverSteamPath, loadLibrary } = require("./library");

class SteamSensor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.activity = options.activity;
    this.focus = options.focus;
    this.discover = options.discover || discoverSteamPath;
    this.loadLibrary = options.loadLibrary || loadLibrary;
    this.games = [];
    this.current = null;
    this.enabled = false;
    this.installed = false;
    this.scanning = false;
    this.generation = 0;
    this.error = "";
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled === true;
    this.generation++;
    clearInterval(this.timer);
    this.current = null;
    if (!this.enabled) { this.games = []; this.installed = false; this.error = ""; return; }
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 30000);
    this.timer.unref?.();
  }

  async refresh() {
    if (!this.enabled || this.scanning) return;
    this.scanning = true;
    const generation = this.generation;
    try {
      const directory = await this.discover();
      const games = directory ? await this.loadLibrary(directory) : [];
      if (!this.enabled || generation !== this.generation) return;
      this.installed = Boolean(directory);
      this.games = games;
      this.error = "";
    } catch {
      if (generation === this.generation) this.error = "Could not read the Steam library. Osmolog will retry.";
    } finally { this.scanning = false; }
  }

  sample() {
    if (!this.enabled) return { available: this.activity?.available === true, installed: false, game: null };
    try {
      const sample = this.activity.sample();
      const foreground = sample.foreground;
      // Match the full installation directory, never just an executable name.
      // Exclude known Steam helpers and launch/update utilities inside games.
      const helper = /^(?:steam(?:webhelper|service)?|gameoverlayui|crashreport.*|crashpad_handler|.*crashhandler.*|unins\d*|setup|install.*|.*launcher|.*updater|easyanticheat.*|beservice)\.exe$/i;
      const game = foreground?.path && !helper.test(path.win32.basename(foreground.path))
        ? this.games.find(candidate => containsPath(candidate.installPath, foreground.path)) : null;
      if (game) this.current = { ...game, pid: foreground.pid, path: foreground.path };
      else if (this.current) {
        const runningPath = this.focus.processImage(this.current.pid);
        if (!runningPath || runningPath.toLowerCase() !== this.current.path.toLowerCase()) this.current = null;
        else {
          const refreshed = this.games.find(item => item.appId === this.current.appId);
          if (refreshed) this.current = { ...this.current, ...refreshed };
        }
      }
      return { ...sample, foreground: undefined, installed: this.installed, error: this.error,
        focused: Boolean(game), game: this.current ? {
          appId: this.current.appId, title: this.current.title, configuredLanguage: this.current.configuredLanguage
        } : null };
    } catch {
      return { available: false, installed: this.installed, game: null, error: "Steam activity detection is unavailable." };
    }
  }

  stop() { this.setEnabled(false); }
}

module.exports = { SteamSensor };
