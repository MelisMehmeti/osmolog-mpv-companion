"use strict";

const { companionExecutablePath } = require("../mpv/auto-launch");
const PLAYERS = ["mpv", "steam", "manatan"];

function loginOptions(app, environment = process.env) {
  return { name: "Osmolog Companion", path: companionExecutablePath({ environment, execPath: process.execPath }),
    args: [...(!app.isPackaged ? [app.getAppPath()] : []), "--startup"] };
}

function desktopPatch(previous, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Invalid settings.");
  const next = { startWithWindows: false, startMinimized: false, keepInTray: true, ...previous, openWith: { ...previous?.openWith } };
  for (const key of Object.keys(patch)) {
    if (["startWithWindows", "startMinimized", "keepInTray"].includes(key) && typeof patch[key] === "boolean") next[key] = patch[key];
    else if (key === "openWith" && patch.openWith && typeof patch.openWith === "object" && !Array.isArray(patch.openWith)) {
      for (const [player, value] of Object.entries(patch.openWith)) {
        if (!PLAYERS.includes(player) || typeof value !== "boolean") throw new Error("Invalid player startup setting.");
        next.openWith[player] = value;
      }
    } else throw new Error("Invalid desktop setting.");
  }
  if (patch.startWithWindows === true && !previous?.startWithWindows) for (const player of PLAYERS) next.openWith[player] = true;
  return next;
}

function createDesktopSettings({ app, service, setMpvStartup, platform = process.platform, environment = process.env }) {
  return {
    supported: platform === "win32",
    configure(patch) {
      const previous = service.config.desktop;
      let next;
      try { next = desktopPatch(previous, patch); } catch (error) { return { ok: false, message: error.message }; }
      const changesLogin = next.startWithWindows !== previous.startWithWindows;
      if (changesLogin && platform !== "win32") return { ok: false, message: "Windows startup is available on Windows." };
      let launcherChanged = false;
      try {
        if (next.openWith.mpv !== previous.openWith.mpv) {
          const result = setMpvStartup(next.openWith.mpv);
          if (!result.ok) return result;
          launcherChanged = true;
        }
        if (changesLogin) {
          const options = loginOptions(app, environment);
          app.setLoginItemSettings({ ...options, openAtLogin: next.startWithWindows, enabled: next.startWithWindows });
          // Electron checks openAtLogin against its AppUserModelID, ignoring our
          // custom entry name. Query the named user entry instead. The launchItems
          // lookup parses path as a command line, so spaces require quotes.
          const actual = app.getLoginItemSettings({ ...options, path: `"${options.path}"` });
          const entry = actual.launchItems?.find(item => item.name === options.name && item.scope === "user");
          if (next.startWithWindows ? !entry : Boolean(entry)) {
            throw new Error(next.startWithWindows ? "Could not register Companion to start with Windows. Try again; if it persists, check your device's startup restrictions." : "Could not remove Companion from Windows startup. Try again.");
          }
          if (next.startWithWindows && !entry.enabled) {
            throw new Error("Windows kept Companion's startup entry disabled. Your device's startup settings or administrator may be restricting it.");
          }
        }
        service.config = service.configStore.update({ desktop: next });
        if (next.startWithWindows || next.openWith.steam || next.openWith.manatan) {
          clearTimeout(service.mpvExitTimer);
          service.mpvExitTimer = null;
        }
        service.publish();
        return { ok: true, message: "Settings saved." };
      } catch (error) {
        if (changesLogin) { try { app.setLoginItemSettings({ ...loginOptions(app, environment), openAtLogin: previous.startWithWindows }); } catch { /* report original failure */ } }
        if (launcherChanged) setMpvStartup(previous.openWith.mpv);
        return { ok: false, message: String(error.message || "Could not save desktop settings.") };
      }
    }
  };
}

function shouldOpenForPlayer(previous = {}, next = {}, desktop = {}) {
  return PLAYERS.some(player => desktop.openWith?.[player] && next.players?.[player]?.connected === true && previous.players?.[player]?.connected !== true);
}

module.exports = { loginOptions, desktopPatch, createDesktopSettings, shouldOpenForPlayer };
