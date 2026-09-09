"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { parseVdf, steamLanguage, containsPath, loadLibrary } = require("../src/steam/library");
const { SteamSensor } = require("../src/steam/sensor");
const { SteamTracker } = require("../src/steam/tracker");
const { WindowsActivitySensor } = require("../src/steam/windows-activity");
const { normalize } = require("../src/config");
const { PendingJournal } = require("../src/journal/journal");
const { CompanionService } = require("../src/service");

function fixture(overrides = {}) {
  const clock = { mono: 0n, wall: new Date(2026, 8, 8, 12).getTime() };
  const config = normalize({ defaultLanguage: "ja", speedCreditMin: 2, steam: { enabled: true, idleSeconds: 60, ...overrides } });
  const tracker = new SteamTracker({ config, monotonicNow: () => clock.mono, wallNow: () => clock.wall });
  const segments = [], checkpoints = [];
  tracker.on("segment", value => segments.push(value));
  tracker.on("checkpoint", value => checkpoints.push(value));
  const sample = { available: true, installed: true, focused: true, idleSeconds: 0, controllerSupported: true,
    game: { appId: "1687950", title: "Persona 5 Royal", configuredLanguage: "ja" } };
  tracker.updateSensor(sample);
  function run(seconds) { for (let i = 0; i < seconds; i++) { clock.mono += 1000000000n; clock.wall += 1000; tracker.tick(); } }
  return { tracker, clock, config, sample, run, segments, checkpoints };
}

test("KeyValues handles escapes, casing, comments and hostile keys without prototype pollution", () => {
  const parsed = parseVdf('"LibraryFolders" { // comment\n "0" { "path" "D:\\\\Steam Library" } "__proto__" { "polluted" "yes" } }');
  assert.equal(parsed.libraryfolders["0"].path, "D:\\Steam Library");
  assert.equal({}.polluted, undefined);
  assert.throws(() => parseVdf('"AppState" { "appid"'));
  assert.throws(() => parseVdf('"a" {'.repeat(40)));
  assert.equal(steamLanguage("koreana"), "ko");
  assert.equal(steamLanguage("schinese"), "zh");
  assert.equal(steamLanguage("unsupported"), "");
  assert(containsPath("D:\\Steam\\common\\Game", "d:\\steam\\common\\game\\bin\\play.exe"));
  assert(!containsPath("D:\\Steam\\common\\Game", "D:\\Steam\\common\\Game 2\\play.exe"));
  assert(!containsPath("D:\\Steam\\common\\Game", "D:\\Steam\\common\\Game\\..\\other.exe"));
});

test("library discovers secondary libraries, rejects traversal and survives a partial manifest", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "osmolog-steam-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const secondary = path.join(directory, "second");
  for (const root of [directory, secondary]) await fs.mkdir(path.join(root, "steamapps"), { recursive: true });
  await fs.writeFile(path.join(directory, "steamapps", "libraryfolders.vdf"), `"LibraryFolders" { "1" { "path" "${secondary.replace(/\\/g, "\\\\")}" } }`);
  await fs.writeFile(path.join(directory, "steamapps", "appmanifest_10.acf"), '"AppState" { "appid" "10" "name" "Example" "installdir" "Game" "UserConfig" { "language" "japanese" } }');
  await fs.writeFile(path.join(directory, "steamapps", "appmanifest_11.acf"), '"AppState" { "appid" "11" "installdir" "../outside" }');
  await fs.writeFile(path.join(directory, "steamapps", "appmanifest_12.acf"), '"AppState" {');
  await fs.writeFile(path.join(secondary, "steamapps", "appmanifest_13.acf"), '"AppState" { "appid" "13" "name" "Second" "installdir" "Second" }');
  const games = await loadLibrary(directory);
  assert.deepEqual(games.map(game => game.appId), ["10", "13"]);
  assert.equal(games[0].configuredLanguage, "ja");
  assert.equal(games[1].configuredLanguage, "");
});

test("sensor keeps a background game, clears exited processes, ignores launchers and sends no paths", () => {
  let foreground = { pid: 123, path: "D:\\Steam\\common\\Game\\bin\\game.exe" };
  let runningPath = foreground.path;
  const sensor = new SteamSensor({ activity: { sample: () => ({ available: true, foreground, idleSeconds: 0 }) },
    focus: { processImage: () => runningPath } });
  sensor.enabled = sensor.installed = true;
  sensor.games = [{ appId: "10", title: "Game", installPath: "D:\\Steam\\common\\Game", configuredLanguage: "ja" }];
  let state = sensor.sample();
  assert.equal(state.game.appId, "10");
  assert.equal(state.focused, true);
  assert(!JSON.stringify(state).includes("D:"));
  foreground = { pid: 123, path: "D:\\Steam\\common\\Game\\CrashBandicoot.exe" };
  runningPath = foreground.path;
  assert.equal(sensor.sample().focused, true, "a game starting with Crash is not a crash reporter");
  foreground = { pid: 456, path: "D:\\Steam\\common\\Game\\launcher.exe" };
  assert.equal(sensor.sample().focused, false);
  foreground = null;
  assert.equal(sensor.sample().game.appId, "10");
  runningPath = "";
  assert.equal(sensor.sample().game, null);
});

test("disabled scanning cannot finish late and restore private library data", async () => {
  let finish;
  const sensor = new SteamSensor({ discover: () => new Promise(resolve => { finish = resolve; }), loadLibrary: async () => [{ appId: "10" }] });
  sensor.setEnabled(true);
  sensor.setEnabled(false);
  finish("D:\\Steam");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sensor.games, []);
  assert.equal(sensor.sample().game, null);
});

test("gaming uses real active time, pauses for focus/idle/manual breaks and resumes without passive credit", () => {
  const f = fixture();
  f.run(10);
  f.tracker.updateSensor({ ...f.sample, focused: false }); f.run(10);
  assert.equal(f.tracker.snapshot().reason, "unfocused");
  f.tracker.updateSensor({ ...f.sample, idleSeconds: 61 }); f.run(10);
  assert.equal(f.tracker.snapshot().reason, "idle");
  f.tracker.updateSensor(f.sample); f.run(5);
  f.tracker.setPaused(true); f.run(10);
  assert.equal(f.tracker.snapshot().reason, "manual-pause");
  f.tracker.setPaused(false); f.run(5);
  f.tracker.end();
  assert.equal(f.segments.reduce((sum, event) => sum + event.creditedSeconds, 0), 20);
  assert(f.segments.every(event => event.mode === "active" && event.player === "steam" && event.appId === "1687950" && event.realSeconds === event.creditedSeconds));
  assert.equal(f.tracker.snapshot().sessionPassiveSeconds, 0);
});

test("missing language never borrows Japanese default; overrides split sessions and exclusions stop counting", () => {
  const f = fixture();
  f.tracker.updateSensor({ ...f.sample, game: { ...f.sample.game, configuredLanguage: "" } });
  f.run(5);
  assert.equal(f.tracker.snapshot().reason, "language-required");
  assert.equal(f.tracker.snapshot().sessionSeconds, 0);
  const updated = normalize({ ...f.config, steam: { ...f.config.steam, games: { "1687950": { language: "en" } } } });
  f.tracker.updateConfig(updated); f.run(5);
  f.tracker.updateConfig(normalize({ ...updated, steam: { ...updated.steam, games: { "1687950": { language: "ko" } } } })); f.run(5);
  f.tracker.updateConfig(normalize({ ...updated, steam: { ...updated.steam, games: { "1687950": { language: "ko", excluded: true } } } })); f.run(5);
  assert.equal(f.tracker.snapshot().reason, "excluded");
  assert.deepEqual(f.segments.map(event => [event.languageCode, event.creditedSeconds]), [["en", 5], ["ko", 5]]);
});

test("game switches have independent identity and reset manual pause; sleep cannot create play time", () => {
  const f = fixture(); f.run(3); f.tracker.setPaused(true);
  f.tracker.updateSensor({ ...f.sample, game: { appId: "20", title: "Game / Part II.2", configuredLanguage: "en" } });
  assert.equal(f.tracker.snapshot().manualPaused, false);
  f.run(3);
  f.clock.mono += 3600n * 1000000000n; f.clock.wall += 3600000;
  f.tracker.tick(); f.run(2); f.tracker.end();
  assert.equal(f.segments.reduce((sum, event) => sum + event.creditedSeconds, 0), 8);
  assert.notEqual(f.segments[0].sessionId, f.segments[1].sessionId);
  assert.equal(f.segments[1].title, "Game / Part II.2");
  assert(f.segments.every(event => event.segmentEndedAt - event.segmentStartedAt <= 5000));
});

test("disabled idle allows cutscenes; unavailable sensor and disabled connector fail closed", () => {
  const f = fixture({ idleSeconds: 0 });
  f.tracker.updateSensor({ ...f.sample, idleSeconds: 500 }); f.run(5);
  assert.equal(f.tracker.snapshot().reason, "tracking");
  f.tracker.updateSensor({ ...f.sample, available: false }); f.run(5);
  assert.equal(f.tracker.snapshot().reason, "unavailable");
  f.tracker.updateConfig(normalize({ ...f.config, steam: { enabled: false } })); f.run(5);
  assert.equal(f.tracker.snapshot().reason, "disabled");
  assert.equal(f.segments.reduce((sum, event) => sum + event.realSeconds, 0), 5);
});

test("titles-off affects snapshots, checkpoints and segments", () => {
  const f = fixture();
  f.tracker.updateConfig({ ...f.config, recordTitles: false }); f.run(5); f.tracker.end();
  assert(!JSON.stringify(f.segments).includes("Persona"));
  assert(!JSON.stringify(f.checkpoints).includes("Persona"));
  assert.equal(f.tracker.snapshot().title, "");
});

test("Steam drafts recover independently from MPV and Manatan", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "osmolog-steam-journal-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const journal = new PendingJournal({ file: path.join(directory, "pending.jsonl") }); journal.open();
  const f = fixture(); f.run(3);
  const draft = f.tracker.engine.draft();
  for (const player of ["mpv", "manatan", "steam"]) journal.saveDraft({ ...draft, player, eventId: crypto.randomUUID() });
  const drafts = journal.consumeDrafts();
  assert.deepEqual(drafts.map(value => value.player), ["mpv", "manatan", "steam"]);
  for (const event of drafts) { journal.append(event); journal.clearDraft(event.player); }
  assert.equal(journal.list().length, 3);
  assert.equal(journal.consumeDrafts().length, 0);
});

test("controller hold counts as input and neutral analog drift does not prevent idle", () => {
  const sensor = Object.create(WindowsActivitySensor.prototype);
  Object.assign(sensor, { available: true, now: () => 1000000, controllerInputAt: -Infinity, controllerPackets: new Map(),
    focus: { foregroundProcess: () => ({ pid: 123, path: "game.exe" }) }, getTickCount: () => 1000000,
    getLastInput: buffer => { buffer.writeUInt32LE(900000, 4); return true; } });
  let stick = 100;
  sensor.xinput = (index, buffer) => { if (index) return 1167; buffer.writeUInt32LE(1, 0); buffer.writeInt16LE(stick, 8); return 0; };
  sensor.sample();
  assert.equal(sensor.sample().idleSeconds, 100);
  stick = 30000;
  assert.equal(sensor.sample().idleSeconds, 0);
});

test("configuration rejects stale game controls and stores only game-specific language", () => {
  const f = fixture();
  const service = new CompanionService({ configStore: { update(patch) { return normalize({ ...f.config, ...patch }); } } });
  service.config = f.config; service.steamTracker = f.tracker;
  assert.equal(service.configureSteam({ appId: "999", language: "en" }).ok, false);
  assert.equal(service.configureSteam({ idleSeconds: -5 }).ok, false);
  assert.equal(service.configureSteam({ appId: "1687950", language: "ko" }).ok, true);
  assert.equal(service.config.defaultLanguage, "ja");
  assert.equal(service.config.steam.games["1687950"].language, "ko");
  assert.equal(service.configureSteam({ appId: "999", paused: true }).ok, false);
});
