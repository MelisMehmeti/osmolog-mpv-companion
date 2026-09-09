"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } = require("electron");
const { setupMpvConnection } = require("../mpv/setup");
const { autoUpdater } = require("electron-updater");
const { CompanionService } = require("../service");
const { companionExecutablePath, installMpvAutoLauncher, removeMpvAutoLauncher } = require("../mpv/auto-launch");
const { createAutoUpdateController, isPortableBuild } = require("./auto-update");
const { syncWithChrome } = require("./sync-controller");

let mainWindow = null;
let tray = null;
let service = null;
let quitting = false;
let expandedBounds = null;
let compactBounds = null;
let windowMode = "expanded";
let hiddenForFullscreen = false;
let latestState = { ready: false, appVersion: app.getVersion() };
let launcherOptions = null;
let detectedMpvConfigDirectory = "";
let launcherStatus = { status: "off", message: "Automatic MPV start is off." };
let updateController = null;
let updateStatus = { state: "disabled" };

if (!app.requestSingleInstanceLock()) app.quit();

function sendState(state = latestState) {
  const distribution = isPortableBuild(process.env) ? "portable" : app.isPackaged ? "installed" : "development";
  latestState = {
    ...state,
    appVersion: app.getVersion(),
    autoLaunchStatus: launcherStatus.status,
    autoLaunchMessage: launcherStatus.message,
    distribution,
    updateStatus
  };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("companion-state", latestState);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (latestState.fullscreen && mainWindow.isVisible()) {
    hiddenForFullscreen = true;
    mainWindow.hide();
  } else if (!latestState.fullscreen && hiddenForFullscreen) {
    hiddenForFullscreen = false;
    mainWindow.showInactive();
  }
}

function updateLauncherStatus(status, message) {
  launcherStatus = { status, message };
  sendState();
}

function showExpanded() {
  if (!mainWindow) return;
  const current = mainWindow.getBounds();
  if (windowMode === "compact") compactBounds = current;
  else expandedBounds = current;
  windowMode = "expanded";
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setResizable(false);
  mainWindow.setBounds(expandedBounds || { x: current.x, y: current.y, width: 620, height: 540 }, true);
  mainWindow.webContents.send("window-mode", "expanded");
  if (latestState.fullscreen) {
    hiddenForFullscreen = true;
    mainWindow.hide();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function showCompact() {
  if (!mainWindow) return;
  const current = mainWindow.getBounds();
  if (windowMode === "expanded") expandedBounds = current;
  windowMode = "compact";
  const bounds = compactBounds || { x: current.x, y: current.y, width: 156, height: 42 };
  mainWindow.setResizable(false);
  mainWindow.setBounds({ ...bounds, width: 156, height: 42 }, true);
  mainWindow.setAlwaysOnTop(true, "floating");
  mainWindow.webContents.send("window-mode", "compact");
  if (latestState.fullscreen) {
    hiddenForFullscreen = true;
    mainWindow.hide();
    return;
  }
  mainWindow.show();
}

function hideToTray() {
  hiddenForFullscreen = false;
  mainWindow?.hide();
}

function findChromeExecutable(environment = process.env) {
  if (process.platform !== "win32") return "";
  const candidates = [environment.PROGRAMFILES, environment["PROGRAMFILES(X86)"], environment.LOCALAPPDATA]
    .filter(Boolean)
    .map(root => path.join(root, "Google", "Chrome", "Application", "chrome.exe"));
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || "";
}

function launchChromeDashboard(url, environment = process.env) {
  const executable = findChromeExecutable(environment);
  if (!executable || !/^chrome-extension:\/\/[a-p]{32}\//i.test(String(url || ""))) return false;
  try {
    const child = childProcess.spawn(executable, [url], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function isChromeRunning(execFile = childProcess.execFile) {
  if (process.platform !== "win32") return Promise.resolve(false);
  return new Promise(resolve => {
    execFile("tasklist.exe", ["/FI", "IMAGENAME eq chrome.exe", "/FO", "CSV", "/NH"], { windowsHide: true }, (error, stdout) => {
      resolve(!error && /^"chrome\.exe"/im.test(String(stdout || "")));
    });
  });
}

function currentMpvConfigDirectory() {
  return String(detectedMpvConfigDirectory || service?.config?.mpvConfigDirectory || "").trim();
}

function launcherOptionsFor(directory = currentMpvConfigDirectory()) {
  return { ...launcherOptions, mpvConfigDirectory: directory };
}

function enableRunOnlyWithMpv() {
  const directory = currentMpvConfigDirectory();
  if (!directory) {
    service.setRunOnlyWithMpv(true, "");
    updateLauncherStatus("needs-mpv", "Open MPV once so Osmolog can detect its configuration folder.");
    return { ok: true, message: launcherStatus.message, state: latestState };
  }
  const result = installMpvAutoLauncher(launcherOptionsFor(directory));
  if (!result.ok) {
    updateLauncherStatus("error", result.message || "Could not install MPV auto-start.");
    return { ok: false, message: launcherStatus.message, state: latestState };
  }
  service.setRunOnlyWithMpv(true, directory);
  updateLauncherStatus("enabled", "Companion will open and close with MPV.");
  return { ok: true, message: launcherStatus.message, state: latestState, file: result.file };
}

function disableRunOnlyWithMpv() {
  const directories = [...new Set([
    detectedMpvConfigDirectory,
    service?.config?.mpvConfigDirectory
  ].map(value => String(value || "").trim()).filter(Boolean))];
  const results = directories.map(directory => removeMpvAutoLauncher(launcherOptionsFor(directory)));
  const failure = results.find(result => !result.ok && !["unsupported", "conflict"].includes(result.reason));
  if (failure) {
    updateLauncherStatus("error", failure.message || "Could not remove MPV auto-start.");
    return { ok: false, message: launcherStatus.message, state: latestState };
  }
  service.setRunOnlyWithMpv(false, currentMpvConfigDirectory());
  updateLauncherStatus("off", "Automatic MPV start is off.");
  return { ok: true, message: launcherStatus.message, state: latestState };
}

async function waitForExtensionConnection(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((service?.transport?.clients?.size || 0) > 0) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return (service?.transport?.clients?.size || 0) > 0;
}

async function waitForJournalAcks(timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((service?.journal?.list?.().length || 0) === 0) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return (service?.journal?.list?.().length || 0) === 0;
}

async function syncNow() {
  return syncWithChrome({
    service,
    isChromeRunning,
    launchChrome: launchChromeDashboard,
    waitForConnection: waitForExtensionConnection,
    waitForAcks: waitForJournalAcks
  });
}

function openDashboard() {
  if (!service) return false;
  if (service.openDashboard("settings")) return true;
  service.startPairing();
  return launchChromeDashboard(service.dashboardUrl("settings"));
}

async function quitCompanion() {
  if (quitting) return;
  quitting = true;
  updateController?.stop();
  await service?.shutdown("app quit");
  app.quit();
}

function createTray() {
  const source = path.join(__dirname, "../../assets/icon-32.png");
  const icon = nativeImage.createFromPath(source).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip("Osmolog Companion");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open mini window", click: showExpanded },
    { label: "Open Osmolog dashboard", click: () => openDashboard() },
    { type: "separator" },
    { label: "Quit companion", click: () => void quitCompanion() }
  ]));
  tray.on("double-click", showExpanded);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 620,
    height: 540,
    minWidth: 156,
    minHeight: 42,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    roundedCorners: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.once("ready-to-show", () => {
    expandedBounds = mainWindow.getBounds();
    if (latestState.fullscreen) hiddenForFullscreen = true;
    else mainWindow.show();
    sendState();
  });
  mainWindow.on("close", event => {
    if (quitting) return;
    event.preventDefault();
    hideToTray();
  });
}

function registerIpc() {
  ipcMain.handle("setup-mpv", async () => {
    const configDirectory = currentMpvConfigDirectory();
    let executable = "";
    if (!configDirectory) {
      const selection = await dialog.showOpenDialog(mainWindow, {
        title: "Choose MPV to set it up", buttonLabel: "Set up MPV",
        filters: [{ name: "MPV application (mpv.exe or mpv.net.exe)", extensions: ["exe", "com"] }], properties: ["openFile"]
      });
      if (selection.canceled) return { ok: false, message: "MPV setup cancelled. No settings were changed." };
      executable = selection.filePaths[0];
    }
    const result = setupMpvConnection({ configDirectory, executable });
    if (result.ok) {
      detectedMpvConfigDirectory = result.directory;
      service.configStore.update({ mpvConfigDirectory: result.directory });
      if (service.config?.runOnlyWithMpv) enableRunOnlyWithMpv();
    }
    return result;
  });
  ipcMain.handle("get-state", () => latestState);
  ipcMain.handle("window-action", (_event, action, details = {}) => {
    if (action === "compact") showCompact();
    if (action === "expand") showExpanded();
    if (action === "hide") hideToTray();
    if (action === "quit") void quitCompanion();
    if (action === "move" && windowMode === "compact" && Number.isFinite(details.x) && Number.isFinite(details.y)) {
      const x = Math.round(details.x);
      const y = Math.round(details.y);
      mainWindow.setPosition(x, y, false);
      compactBounds = { ...mainWindow.getBounds(), x, y, width: 156, height: 42 };
    }
    return true;
  });
  ipcMain.handle("start-pairing", () => service.startPairing());
  ipcMain.handle("set-extension-id", (_event, extensionId) => service.setExtensionId(extensionId));
  ipcMain.handle("set-language", (_event, languageCode) => service.setLanguage(languageCode));
  ipcMain.handle("configure-steam", (_event, patch) => service.configureSteam(patch));
  ipcMain.handle("open-dashboard", () => openDashboard());
  ipcMain.handle("set-run-only-with-mpv", (_event, enabled) => enabled ? enableRunOnlyWithMpv() : disableRunOnlyWithMpv());
  ipcMain.handle("sync-now", () => syncNow());
  ipcMain.handle("restart-for-update", async () => {
    if (quitting) return { ok: false, message: "Companion is already closing." };
    const result = await updateController?.restartAndInstall();
    if (!result?.ok) quitting = false;
    return result || { ok: false, message: "No update is ready to install." };
  });
}

app.on("second-instance", () => showExpanded());
app.on("window-all-closed", () => {});
app.on("before-quit", event => {
  if (!quitting) {
    event.preventDefault();
    void quitCompanion();
  }
});

app.whenReady().then(async () => {
  app.setAppUserModelId("com.osmolog.mpv-companion");
  registerIpc();
  createWindow();
  createTray();
  service = new CompanionService();
  service.on("state", sendState);
  service.on("log", entry => mainWindow?.webContents.send("companion-log", entry));
  launcherOptions = {
    environment: process.env,
    execPath: companionExecutablePath({ environment: process.env, execPath: process.execPath }),
    appPath: app.getAppPath(),
    packaged: app.isPackaged
  };
  service.on("mpv-config-directory", directory => {
    detectedMpvConfigDirectory = String(directory || "").trim();
    if (service.config?.runOnlyWithMpv === true) enableRunOnlyWithMpv();
    else updateLauncherStatus("off", "Automatic MPV start is off.");
  });
  service.on("exit-requested", () => void quitCompanion());
  await service.start();
  updateController = createAutoUpdateController({
    app,
    updater: autoUpdater,
    logger: service.logger,
    beforeInstall: async () => {
      quitting = true;
      await service.shutdown("install update");
    },
    onStatus: status => {
      if (status.state === "error" && ["preparing", "installing"].includes(updateStatus.state)) quitting = false;
      updateStatus = status;
      sendState();
    }
  });
  updateController.start();
  if (service.config?.runOnlyWithMpv === true) {
    const directory = currentMpvConfigDirectory();
    if (directory) enableRunOnlyWithMpv();
    else updateLauncherStatus("needs-mpv", "Open MPV once so Osmolog can repair auto-start.");
  }
  sendState(service.publicState());
}).catch(async error => {
  await service?.shutdown("startup error").catch(() => null);
  latestState = { ready: false, fatalError: String(error?.message || error) };
  sendState(latestState);
});

module.exports = { findChromeExecutable, isChromeRunning, launchChromeDashboard };
