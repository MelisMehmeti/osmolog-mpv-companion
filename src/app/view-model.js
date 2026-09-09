"use strict";
(function(root) {
  function duration(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    if (value < 60) return `${value}s`;
    const hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60), remainder = value % 60;
    return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m ${String(remainder).padStart(2, "0")}s`;
  }
  function mode(playback = {}) {
    if (playback.manualPaused) return { color: "stopped", label: "Tracking paused" };
    if (playback.muted) return { color: "stopped", label: "Muted" };
    if (playback.playing && playback.mode === "active") return { color: "active", label: "Active" };
    if (playback.playing && playback.mode === "passive") return { color: "passive", label: "Passive" };
    const reasons = { idle: "Idle · timer stopped", excluded: "Game excluded", "language-required": "Choose a tracking language", unavailable: "Activity detection unavailable" };
    return { color: "stopped", label: reasons[playback.reason] || (playback.paused ? "Playback paused" : "Waiting for playback") };
  }
  function connection(playback = {}) {
    if (!playback.connected) return { label: "Waiting", color: "waiting" };
    if (playback.playing && ["active", "passive"].includes(playback.mode)) return { label: "Now tracking", color: playback.mode };
    return { label: "Connected", color: "active" };
  }
  const api = { duration, mode, connection };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CompanionView = api;
})(globalThis);
