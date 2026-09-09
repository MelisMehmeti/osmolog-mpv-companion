"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("osmolog", Object.freeze({
  getState: () => ipcRenderer.invoke("get-state"),
  setupMpv: () => ipcRenderer.invoke("setup-mpv"),
  windowAction: (action, details) => ipcRenderer.invoke("window-action", action, details),
  startPairing: () => ipcRenderer.invoke("start-pairing"),
  setExtensionId: extensionId => ipcRenderer.invoke("set-extension-id", extensionId),
  setLanguage: languageCode => ipcRenderer.invoke("set-language", languageCode),
  configureSteam: patch => ipcRenderer.invoke("configure-steam", patch),
  setRunOnlyWithMpv: enabled => ipcRenderer.invoke("set-run-only-with-mpv", enabled),
  syncNow: () => ipcRenderer.invoke("sync-now"),
  restartForUpdate: () => ipcRenderer.invoke("restart-for-update"),
  openDashboard: () => ipcRenderer.invoke("open-dashboard"),
  onState: callback => ipcRenderer.on("companion-state", (_event, state) => callback(state)),
  onWindowMode: callback => ipcRenderer.on("window-mode", (_event, mode) => callback(mode))
}));
