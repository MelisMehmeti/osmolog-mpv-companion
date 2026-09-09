"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CompanionService } = require("../src/service");
const { normalize } = require("../src/config");

test("player defaults and session controls do not modify another player's current session", () => {
  const service = new CompanionService();
  service.config = normalize({ defaultLanguage: "ja" });
  service.configStore = { update: patch => (service.config = normalize({ ...service.config, ...patch })) };
  service.tracker = { fileLoaded: true, sessionId: "mpv-one", snapshot: () => ({}), setLanguageOverride: () => { throw Error("wrong player"); } };
  let paused = false;
  service.manatanTracker = { snapshot: () => ({}), engine: { fileLoaded: true, sessionId: "manatan-one", setPaused: value => { paused = value; } } };
  assert.equal(service.setPlayerLanguage("manatan", "ko").ok, true);
  assert.equal(service.config.playerLanguages.manatan, "ko");
  assert.equal(service.config.defaultLanguage, "ja");
  assert.equal(service.setTrackingPaused("manatan", true, "old-session").ok, false);
  assert.equal(paused, false);
  assert.equal(service.setTrackingPaused("manatan", true, "manatan-one").ok, true);
  assert.equal(paused, true);
});

test("a language chosen during playback becomes the next-session default", () => {
  let currentLanguage = "ja";
  const configStore = {
    update(patch) { return { defaultLanguage: patch.defaultLanguage, extensionId: "PUT_EXTENSION_ID_HERE", port: 47823 }; }
  };
  const service = new CompanionService({ configStore });
  service.config = { defaultLanguage: "ja", extensionId: "PUT_EXTENSION_ID_HERE", port: 47823 };
  service.tracker = {
    fileLoaded: true,
    properties: {},
    setLanguageOverride(languageCode) { currentLanguage = languageCode; return true; },
    snapshot() { return { languageCode: currentLanguage }; }
  };

  const result = service.setLanguage("en");
  assert.equal(result.ok, true);
  assert.equal(result.scope, "file-and-default");
  assert.equal(service.config.defaultLanguage, "en");
  assert.equal(result.state.languageCode, "en");
});
