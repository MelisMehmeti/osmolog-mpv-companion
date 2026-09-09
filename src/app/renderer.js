"use strict";

const LANGUAGE_NAMES = { ja: "Japanese", en: "English", sv: "Swedish", es: "Spanish", fr: "French", de: "German", ko: "Korean", zh: "Chinese", ar: "Arabic", bg: "Bulgarian", cs: "Czech", da: "Danish", nl: "Dutch", fi: "Finnish", el: "Greek", hu: "Hungarian", id: "Indonesian", it: "Italian", no: "Norwegian", pl: "Polish", pt: "Portuguese", ro: "Romanian", ru: "Russian", th: "Thai", tr: "Turkish", uk: "Ukrainian", vi: "Vietnamese" };
const byId = id => document.getElementById(id);
let state = { ready: false };

function createPreviewBridge() {
  const preview = new URLSearchParams(location.search).get("preview");
  let previewState = {
    ready: true,
    appVersion: "preview",
    mpvConnected: preview === "mpv" || preview === "tracking",
    paired: preview === "tracking",
    extensionConnected: preview === "tracking",
    playing: preview === "tracking",
    paused: false,
    fileLoaded: preview === "tracking",
    mode: preview === "tracking" ? "active" : "",
    title: preview === "tracking" ? "Frieren - 07" : "",
    languageCode: "ja",
    sessionSeconds: preview === "tracking" ? 305 : 0,
    sessionActiveSeconds: preview === "tracking" ? 245 : 0,
    sessionPassiveSeconds: preview === "tracking" ? 60 : 0,
    todaySeconds: preview === "tracking" ? 4825 : 0,
    speed: 1,
    pairingSeconds: preview === "tracking" ? 0 : 300,
    runOnlyWithMpv: false,
    autoLaunchStatus: "off",
    autoLaunchMessage: "Automatic MPV start is off.",
    distribution: "installed",
    updateStatus: { state: "current" },
    pendingSegments: 0
  };
  const stateListeners = [];
  const modeListeners = [];
  const publish = () => stateListeners.forEach(listener => listener(previewState));
  return Object.freeze({
    getState: async () => previewState,
    onState: listener => stateListeners.push(listener),
    onWindowMode: listener => modeListeners.push(listener),
    windowAction: action => {
      if (action === "compact" || action === "expand") modeListeners.forEach(listener => listener(action === "compact" ? "compact" : "expanded"));
    },
    startPairing: async () => { previewState = { ...previewState, pairingSeconds: 60 }; publish(); return previewState; },
    setLanguage: async languageCode => { previewState = { ...previewState, languageCode }; publish(); return { ok: true, scope: previewState.fileLoaded ? "file" : "default" }; },
    configureSteam: async patch => { previewState = { ...previewState, steam: { ...previewState.steam, ...patch } }; publish(); return { ok: true }; },
    setRunOnlyWithMpv: async enabled => {
      previewState = {
        ...previewState,
        runOnlyWithMpv: enabled,
        autoLaunchStatus: enabled ? "enabled" : "off",
        autoLaunchMessage: enabled ? "Companion will open and close with MPV." : "Automatic MPV start is off."
      };
      publish();
      return { ok: true, message: previewState.autoLaunchMessage, state: previewState };
    },
    syncNow: async () => ({ ok: true, message: "Everything is already synced." }),
    openDashboard: async () => false
  });
}

const companionApi = window.osmolog || createPreviewBridge();

function duration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  if (value < 60) return `${value}s`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainder = value % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function setupContent(current) {
  if (current.fatalError) return { eyebrow: "COMPANION ERROR", title: "Could not start", copy: current.fatalError, button: "Retry after restart", disabled: true };
  if (!current.ready) return { eyebrow: "GETTING READY", title: "Starting companion…", copy: "Opening the local tracker and crash-safe journal.", button: "Starting…", disabled: true };
  if (!current.extensionConnected) return current.paired ? {
    eyebrow: "OSMOLOG CONNECTION",
    title: "Reconnecting to Osmolog…",
    copy: "Keep the companion open. Osmolog reconnects in Chrome's background; the dashboard does not need to be open.",
    button: "",
    disabled: true
  } : {
    eyebrow: "FIRST-TIME CONNECTION",
    title: "Connect Osmolog once",
    copy: "Open Osmolog once and allow local companion access. After setup, the dashboard can stay closed.",
    button: "Open Osmolog",
    disabled: false
  };
  if (!current.mpvConnected && !current.manatanConnected && !current.steam?.connected) return {
    eyebrow: "PLAYER CONNECTION",
    title: "Connected — waiting for a player",
    copy: "Start MPV, open a video in Manatan, or enable Steam tracking below and open a game.",
    button: "",
    disabled: true
  };
  return null;
}

function render(next) {
  state = next || state;
  byId("appVersion").textContent = state.appVersion ? `Companion v${state.appVersion}` : "Companion · version unavailable";
  const connected = state.extensionConnected === true;
  const status = byId("connectionStatus");
  status.className = `connection-status${connected ? " is-connected" : state.pairingSeconds ? " is-pairing" : ""}`;
  status.querySelector("b").textContent = connected ? "CONNECTED TO OSMOLOG" : state.pairingSeconds ? `NOT CONNECTED · READY TO PAIR` : "NOT CONNECTED";

  const setup = setupContent(state);
  byId("setupPanel").hidden = !setup;
  byId("trackingPanel").hidden = Boolean(setup);
  if (setup) {
    byId("setupEyebrow").textContent = setup.eyebrow;
    byId("setupTitle").textContent = setup.title;
    byId("setupCopy").textContent = setup.copy;
    byId("pairButton").textContent = setup.button;
    byId("pairButton").disabled = setup.disabled;
    byId("setupActions").hidden = !setup.button;
    if (connected) byId("setupFeedback").textContent = "";
  }

  const languageCode = state.languageCode || (state.player === "steam" ? "" : "ja");
  const languageName = LANGUAGE_NAMES[languageCode] || languageCode.toUpperCase() || "Choose language";
  if (document.activeElement !== byId("languageSelect")) byId("languageSelect").value = languageCode;
  const sourceLabel = state.player === "steam" ? "STEAM" : state.player === "manatan" ? "MANATAN" : "MPV";
  byId("activePlayerIcon").setAttribute("src", state.player === "steam" ? "../../assets/steam.svg" : state.player === "manatan" ? "../../assets/manatan.png" : "../../assets/mpv.svg");
  byId("trackingSourceEyebrow").textContent = `${sourceLabel} · TRACKING`;
  byId("mediaTitle").textContent = state.title || (state.fileLoaded ? "Local media" : "No media loaded");
  const playbackStatus = state.player === "steam" ? steamReason(state.steam) : state.playing ? "Tracking now" : state.fileLoaded && state.paused ? "Playback paused" : "Ready to track";
  byId("sessionTimeLabel").textContent = state.player === "steam" ? "THIS GAME SESSION" : "THIS FILE";
  byId("modeLabel").textContent = playbackStatus;
  byId("modeDot").className = state.mode === "active" ? "is-active" : state.mode === "passive" ? "is-passive" : "";
  byId("fileTime").textContent = duration(state.sessionSeconds);
  byId("todayLabel").textContent = `OSMOLOG TODAY · ${languageCode.toUpperCase()}`;
  byId("todayLabel").title = `All Osmolog sources tracked today in ${languageName}`;
  byId("todayTime").textContent = duration(state.todaySeconds);
  byId("speedValue").textContent = `${Number(state.speed || 1).toFixed(1)}×`;
  byId("activeLabel").textContent = `Active ${duration(state.sessionActiveSeconds)}`;
  byId("passiveLabel").textContent = `Passive ${duration(state.sessionPassiveSeconds)}`;
  const total = Math.max(0, Number(state.sessionActiveSeconds) + Number(state.sessionPassiveSeconds));
  byId("activeTrack").style.width = `${total ? state.sessionActiveSeconds / total * 100 : 0}%`;
  byId("passiveTrack").style.width = `${total ? state.sessionPassiveSeconds / total * 100 : 0}%`;
  byId("footerStatus").textContent = state.pendingSegments
    ? `${state.pendingSegments} segment${state.pendingSegments === 1 ? "" : "s"} waiting for Osmolog. Closing keeps tracking.`
    : state.extensionConnected ? "Closing keeps tracking in the tray." : state.paired ? "Osmolog will reconnect automatically in the background." : "Open Osmolog once to finish the local connection.";
  byId("pairAgain").hidden = state.extensionConnected;

  const lifecycleToggle = byId("runOnlyWithMpvToggle");
  if (document.activeElement !== lifecycleToggle) lifecycleToggle.checked = state.runOnlyWithMpv === true;
  const autoLaunchLabels = { enabled: "Enabled", "needs-mpv": "Needs MPV", error: "Needs attention", off: "Off" };
  byId("autoLaunchStatus").textContent = autoLaunchLabels[state.autoLaunchStatus] || "Off";
  byId("autoLaunchStatus").title = state.autoLaunchMessage || "";
  byId("autoLaunchStatus").className = state.autoLaunchStatus === "enabled" ? "is-enabled" : state.autoLaunchStatus === "error" ? "is-error" : "";
  byId("autoLaunchDescription").textContent = state.distribution === "portable"
    ? "Keep this EXE in a permanent folder before enabling. It closes safely when MPV closes."
    : "It closes safely when MPV closes.";
  if (state.steam?.enabled) byId("autoLaunchDescription").textContent = "Companion stays open while Steam tracking is enabled.";
  const update = state.updateStatus || {};
  const updateVersion = update.version ? ` ${update.version}` : "";
  const updateMessages = {
    portable: "Portable version · download updates manually from GitHub Releases.",
    disabled: "Automatic updates are available in the installed version.",
    idle: "Installed version · updates download automatically.",
    checking: "Checking for a companion update…",
    current: "Companion is up to date.",
    downloading: `Downloading Companion${updateVersion} in the background…`,
    ready: `Companion${updateVersion} is ready and will install after this app closes.`,
    error: "Could not check for updates; the companion will retry automatically."
  };
  byId("updateStatus").textContent = updateMessages[update.state] || updateMessages.disabled;
  byId("updateStatus").className = update.state === "ready" ? "is-ready" : update.state === "error" ? "is-error" : "";

  byId("compactTime").textContent = duration(state.sessionSeconds);
  byId("compactLanguage").textContent = languageName.toUpperCase();
  byId("compactDot").className = state.mode === "active" ? "is-active" : state.mode === "passive" ? "is-passive" : "";
  const steam = state.steam || {};
  byId("steamEnabled").checked = steam.enabled === true;
  byId("steamSummary").textContent = steam.enabled ? "Enabled" : "Off";
  byId("steamState").textContent = steam.error || steamReason(steam);
  if (document.activeElement !== byId("steamIdleSeconds")) {
    const idle = String(steam.idleThresholdSeconds ?? 300);
    if (![...byId("steamIdleSeconds").options].some(option => option.value === idle)) byId("steamIdleSeconds").add(new Option(`${Number(idle) / 60} minutes`, idle));
    byId("steamIdleSeconds").value = idle;
  }
  byId("steamGameControls").hidden = !steam.appId;
  byId("steamGameTitle").textContent = steam.title || "Steam game";
  byId("steamLanguage").options[0].textContent = `Steam setting · ${LANGUAGE_NAMES[steam.configuredLanguage] || steam.configuredLanguage || "unknown"}`;
  if (document.activeElement !== byId("steamLanguage")) byId("steamLanguage").value = steam.languageOverride || "";
  byId("steamExcluded").checked = steam.excluded === true;
  byId("steamPause").textContent = steam.manualPaused ? "Resume tracking" : "Pause tracking";
}

function steamReason(steam = {}) {
  return ({ disabled: "Steam tracking is off", unavailable: "Windows activity detection is unavailable", "steam-not-found": "Looking for Steam",
    waiting: "Open a Steam game and bring its window forward", excluded: "This game is excluded", "manual-pause": "Tracking paused by you",
    "language-required": "Choose this game’s language", unfocused: "Game in background · timer stopped", idle: "Idle · timer stopped", tracking: "Counting Gaming time" })[steam.reason] || "Steam tracking is off";
}

for (const [code, name] of Object.entries(LANGUAGE_NAMES)) {
  byId("steamLanguage").add(new Option(name, code));
  if (![...byId("languageSelect").options].some(option => option.value === code)) byId("languageSelect").add(new Option(name, code));
}
byId("languageSelect").add(new Option("Choose language", ""));
async function updateSteam(patch) {
  byId("steamControls").disabled = true;
  try {
    const result = await companionApi.configureSteam(patch);
    byId("steamFeedback").textContent = result?.ok ? "Steam settings saved." : result?.message || "Could not update Steam settings.";
  } catch { byId("steamFeedback").textContent = "Could not save Steam settings. Try again."; }
  finally { byId("steamControls").disabled = false; }
}
byId("steamEnabled").addEventListener("change", event => void updateSteam({ enabled: event.target.checked }));
byId("steamIdleSeconds").addEventListener("change", event => void updateSteam({ idleSeconds: Number(event.target.value) }));
byId("steamLanguage").addEventListener("change", event => void updateSteam({ appId: state.steam.appId, language: event.target.value }));
byId("steamExcluded").addEventListener("change", event => void updateSteam({ appId: state.steam.appId, excluded: event.target.checked }));
byId("steamPause").addEventListener("click", () => void updateSteam({ appId: state.steam.appId, paused: !state.steam.manualPaused }));

byId("minimizeButton").addEventListener("click", () => companionApi.windowAction("compact"));
byId("closeButton").addEventListener("click", () => companionApi.windowAction("hide"));
const compactOverlay = byId("compactOverlay");
let compactDrag = null;
compactOverlay.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  compactDrag = { pointerId: event.pointerId, startX: event.screenX, startY: event.screenY, offsetX: event.clientX, offsetY: event.clientY, moved: false };
  compactOverlay.setPointerCapture(event.pointerId);
});
compactOverlay.addEventListener("pointermove", event => {
  if (!compactDrag || compactDrag.pointerId !== event.pointerId) return;
  if (Math.hypot(event.screenX - compactDrag.startX, event.screenY - compactDrag.startY) >= 3) compactDrag.moved = true;
  if (compactDrag.moved) void companionApi.windowAction("move", { x: event.screenX - compactDrag.offsetX, y: event.screenY - compactDrag.offsetY });
});
compactOverlay.addEventListener("pointerup", event => {
  if (!compactDrag || compactDrag.pointerId !== event.pointerId) return;
  const moved = compactDrag.moved;
  compactDrag = null;
  compactOverlay.releasePointerCapture(event.pointerId);
  if (!moved) void companionApi.windowAction("expand");
});
compactOverlay.addEventListener("pointercancel", () => { compactDrag = null; });
byId("pairButton").addEventListener("click", async () => {
  await companionApi.startPairing();
  const opened = await companionApi.openDashboard();
  byId("setupFeedback").textContent = opened
    ? "Osmolog opened. On first setup, select Connect MPV once if Chrome asks for local access."
    : "Could not open Chrome automatically. Open Osmolog, then select Connect MPV once if Chrome asks for local access.";
});
byId("pairAgain").addEventListener("click", async () => {
  await companionApi.startPairing();
  byId("setupFeedback").textContent = "Pairing is ready. Open Osmolog in Chrome once to finish reconnecting.";
});
byId("languageSelect").addEventListener("change", async event => {
  if (!event.target.value) return;
  const result = await companionApi.setLanguage(event.target.value);
  byId("footerStatus").textContent = result.scope === "game" ? "Language saved for this Steam game." : result.scope === "file-and-default"
    ? "Language changed and saved for future MPV sessions."
    : "Default language saved for future MPV sessions.";
});
byId("openDashboard").addEventListener("click", async () => {
  const opened = await companionApi.openDashboard();
  if (!opened) byId("footerStatus").textContent = "Open Osmolog in Chrome to view the dashboard.";
});
byId("runOnlyWithMpvToggle").addEventListener("change", async event => {
  const toggle = event.currentTarget;
  toggle.disabled = true;
  byId("lifecycleFeedback").textContent = toggle.checked ? "Setting up MPV auto-start…" : "Removing MPV auto-start…";
  const result = await companionApi.setRunOnlyWithMpv(toggle.checked);
  byId("lifecycleFeedback").textContent = result?.message || (result?.ok ? "Lifecycle setting updated." : "Could not update this setting.");
  if (!result?.ok) toggle.checked = state.runOnlyWithMpv === true;
  toggle.disabled = false;
});
byId("syncNowButton").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Syncing…";
  byId("lifecycleFeedback").textContent = "Connecting to Osmolog…";
  const result = await companionApi.syncNow();
  byId("lifecycleFeedback").textContent = result?.message || "Could not sync right now.";
  button.textContent = "Sync now";
  button.disabled = false;
});

companionApi.onState(render);
companionApi.onWindowMode(mode => byId("appShell").dataset.mode = mode);
companionApi.getState().then(render);
