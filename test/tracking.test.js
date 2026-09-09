"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { TrackingEngine } = require("../src/tracking/tracker");
const { cleanTitle } = require("../src/util");

class FakeClock {
  constructor(wall = new Date(2026, 7, 29, 12, 0, 0).getTime()) {
    this.mono = 0n;
    this.wall = wall;
  }
  advance(seconds, wallSeconds = seconds) {
    this.mono += BigInt(Math.round(seconds * 1e9));
    this.wall += wallSeconds * 1000;
    return this.times();
  }
  times() { return { mono: this.mono, wall: this.wall }; }
}

function config(overrides = {}) {
  return {
    defaultLanguage: "ja",
    folderRules: [{ match: "D:\\Media\\Japanese", language: "ja" }],
    recordTitles: true,
    speedCreditMin: 1,
    speedCreditMax: 2,
    overlay: { toastOnLoad: true, persistent: false },
    ...overrides
  };
}

function createEngine(options = {}) {
  const clock = options.clock || new FakeClock();
  const engine = new TrackingEngine({ config: options.config || config(), monotonicNow: () => clock.mono, wallNow: () => clock.wall });
  const segments = [];
  engine.on("segment", segment => segments.push(segment));
  engine.loadFile({
    path: options.path || "D:\\Media\\Japanese\\[Group] Show - 01 (1080p) [HEVC].mkv",
    filename: "[Group] Show - 01 (1080p) [HEVC].mkv",
    properties: {
      pause: false, "core-idle": false, "paused-for-cache": false, mute: false, volume: 100,
      speed: options.speed || 1, focused: true, "idle-active": false, "eof-reached": false,
      "sub-visibility": true, "current-tracks/audio/lang": "jpn", "current-tracks/sub/lang": "eng",
      "track-list": options.trackList || [{ type: "video" }, { type: "audio" }]
    }
  }, clock.times());
  return { clock, engine, segments };
}

function run(engine, clock, seconds) {
  for (let index = 0; index < seconds; index += 1) engine.tick(clock.advance(1));
}

test("a short fragment is delivered before its recoverable draft is cleared", () => {
  const { engine, clock, segments } = createEngine();
  const order = [];
  engine.on("segment", () => order.push("journal"));
  engine.on("checkpoint", draft => { if (!draft) order.push("clear-draft"); });
  run(engine, clock, 2);
  engine.beginSeek(clock.times());
  assert.equal(segments.length, 1);
  assert.equal(segments[0].realSeconds, 2);
  assert.deepEqual(order, ["journal", "clear-draft"]);
});

test("active playback closes into passive on alt-tab", () => {
  const { engine, clock, segments } = createEngine();
  run(engine, clock, 60);
  engine.updateProperty("focused", false, clock.times());
  run(engine, clock, 10);
  engine.endFile(clock.times());
  assert.equal(Math.round(segments[0].creditedSeconds), 60);
  assert.equal(segments[0].mode, "active");
  assert.equal(segments.at(-1).mode, "passive");
  assert.equal(Math.round(segments.at(-1).creditedSeconds), 10);
});

for (const [property, value] of [["pause", true], ["mute", true], ["volume", 0], ["paused-for-cache", true]]) {
  test(`${property} stops counting`, () => {
    const { engine, clock, segments } = createEngine();
    run(engine, clock, 10);
    engine.updateProperty(property, value, clock.times());
    run(engine, clock, 10);
    engine.endFile(clock.times());
    assert.equal(Math.round(segments.reduce((sum, segment) => sum + segment.realSeconds, 0)), 10);
  });
}

test("seeking adds no time", () => {
  const { engine, clock, segments } = createEngine();
  run(engine, clock, 10);
  engine.beginSeek(clock.times());
  run(engine, clock, 20);
  engine.playbackRestart(clock.times());
  run(engine, clock, 10);
  engine.endFile(clock.times());
  assert.equal(Math.round(segments.reduce((sum, segment) => sum + segment.realSeconds, 0)), 20);
});

for (const [speed, credited] of [[0.5, 60], [1.5, 90], [10, 120]]) {
  test(`speed ${speed} credits ${credited} seconds for one minute`, () => {
    const { engine, clock, segments } = createEngine({ speed });
    run(engine, clock, 60);
    engine.endFile(clock.times());
    const result = segments[0];
    assert.equal(Math.round(result.realSeconds), 60);
    assert.equal(Math.round(result.contentSeconds), Math.round(60 * speed));
    assert.equal(Math.round(result.creditedSeconds), credited);
    assert.equal(result.maxSpeedSeen, speed);
  });
}

test("folder rules win and missing defaults remain unassigned", () => {
  const first = createEngine();
  assert.deepEqual(first.engine.language, { languageCode: "ja", languageSource: "folderRule" });
  const second = createEngine({ path: "E:\\Unsorted\\Show.mkv", config: config({ defaultLanguage: null, folderRules: [] }) });
  assert.deepEqual(second.engine.language, { languageCode: null, languageSource: "unassigned" });
});

test("audio-only playback still counts", () => {
  const { engine, clock, segments } = createEngine({ trackList: [{ type: "audio" }] });
  run(engine, clock, 10);
  engine.endFile(clock.times());
  assert.equal(segments[0].hasVideo, false);
  assert.equal(Math.round(segments[0].realSeconds), 10);
});

test("local midnight splits segments", () => {
  const clock = new FakeClock(new Date(2026, 7, 29, 23, 59, 55).getTime());
  const { engine, segments } = createEngine({ clock });
  run(engine, clock, 10);
  engine.endFile(clock.times());
  assert.equal(segments.length, 2);
  assert.notEqual(segments[0].localDate, segments[1].localDate);
  assert.equal(Math.round(segments.reduce((sum, segment) => sum + segment.realSeconds, 0)), 10);
});

test("wall-clock jumps do not create phantom duration", () => {
  const { engine, clock, segments } = createEngine();
  engine.tick(clock.advance(1, 3601));
  engine.endFile(clock.times());
  assert.equal(Math.round(segments[0].realSeconds), 1);
});

test("title and track hints are privacy-bounded metadata", () => {
  const { engine, clock, segments } = createEngine();
  run(engine, clock, 5);
  engine.endFile(clock.times());
  assert.equal(segments[0].title, "Show - 01");
  assert.equal(segments[0].audioTrackLang, "jpn");
  assert.equal(segments[0].subTrackLang, "eng");
  assert.equal(segments[0].subsVisible, true);
  assert.equal("path" in segments[0], false);
});

test("title cleaning preserves the filename's original capitalization", () => {
  assert.equal(cleanTitle("[Group] My ANIME Episode 07 [1080p] [HEVC].mkv"), "My ANIME Episode 07");
});

test("the mini app can change language and shows active/passive file totals", () => {
  const { engine, clock, segments } = createEngine();
  run(engine, clock, 10);
  assert.equal(engine.setLanguageOverride("en", clock.times()), true);
  run(engine, clock, 5);
  engine.updateProperty("focused", false, clock.times());
  run(engine, clock, 4);

  const snapshot = engine.snapshot();
  assert.equal(snapshot.languageCode, "en");
  assert.equal(Math.round(snapshot.sessionSeconds), 19);
  assert.equal(Math.round(snapshot.sessionActiveSeconds), 15);
  assert.equal(Math.round(snapshot.sessionPassiveSeconds), 4);
  engine.endFile(clock.times());
  assert.deepEqual(segments.map(segment => segment.languageCode), ["ja", "en", "en"]);
  assert.equal(segments[1].languageSource, "app");
});
