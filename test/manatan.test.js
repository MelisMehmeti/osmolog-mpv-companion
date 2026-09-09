"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { TrackingEngine } = require("../src/tracking/tracker");
const { POWERSHELL_SENSOR, safeSensorState } = require("../src/manatan/media-session-sensor");
const { manatanTitle } = require("../src/manatan/tracker");

const config = {
  defaultLanguage: "ja", folderRules: [], recordTitles: true,
  speedCreditMin: 1, speedCreditMax: 2, overlay: { toastOnLoad: false, persistent: false }
};

test("Manatan segments use their own player identity", async () => {
  let mono = 0n;
  let wall = Date.now();
  const engine = new TrackingEngine({
    config, player: "manatan", monotonicNow: () => mono, wallNow: () => wall,
    resolveLanguage: () => ({ languageCode: "ja", languageSource: "default" })
  });
  engine.loadFile({ filename: "Example episode", properties: {
    pause: false, "core-idle": false, "paused-for-cache": false, mute: false, volume: 100,
    speed: 1, focused: true, "idle-active": false, "eof-reached": false,
    "track-list": [{ type: "video" }]
  } });
  const segmentPromise = once(engine, "segment");
  mono += 6_000_000_000n;
  wall += 6000;
  engine.tick();
  engine.endFile();
  const [segment] = await segmentPromise;
  assert.equal(segment.player, "manatan");
  assert.equal(segment.languageCode, "ja");
  assert.equal(Math.round(segment.realSeconds), 5, "one delayed poll is bounded like MPV tracking");
});

test("Manatan sensor state is privacy-bounded and normalized", () => {
  const state = safeSensorState({
    available: true, appRunning: true, found: true, playing: true,
    title: `Title\n${"x".repeat(400)}`, volume: 500, playbackRate: 99
  });
  assert.equal(state.title.includes("\n"), false);
  assert.equal(state.title.length, 240);
  assert.equal(state.volume, 100);
  assert.equal(state.playbackRate, 10);
});

test("native sensor combines Windows media controls with process audio fallback", () => {
  assert.match(POWERSHELL_SENSOR, /GlobalSystemMediaTransportControlsSessionManager/);
  assert.match(POWERSHELL_SENSOR, /IAudioSessionManager2/);
  assert.match(POWERSHELL_SENSOR, /GetProcessId/);
  assert.match(POWERSHELL_SENSOR, /Get-Process -Name "Manatan"/);
});

test("Manatan titles combine episode and subtitle without exposing arbitrary fields", () => {
  assert.equal(manatanTitle({ title: "Frieren", subtitle: "Episode 7" }), "Frieren · Episode 7");
  assert.equal(manatanTitle({}), "Manatan video");
});
