"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.join(__dirname, "../src/app");
const read = name => fs.readFileSync(path.join(appRoot, name), "utf8");

test("desktop shell keeps the requested minimize, tray-close, and exact compact controls", () => {
  const html = read("index.html");
  const css = read("styles.css");
  const main = read("main.js");
  const renderer = read("renderer.js");

  assert.match(html, /id="minimizeButton"[^>]*>−<\/button>/);
  assert.match(html, /id="closeButton"[^>]*>×<\/button>/);
  assert.match(html, /id="compactTime"/);
  assert.match(html, /id="compactLanguage"/);
  assert.match(html, /id="pairAgain"/);
  assert.match(html, /osmolog-icon-small\.svg/);
  assert.ok(html.indexOf("tracking-toolbar") < html.indexOf("now-playing"));
  assert.match(html, /PLAYBACK SPEED/);
  assert.match(html, /id="todayLabel"[^>]*>OSMOLOG TODAY · JA/);
  assert.match(renderer, /OSMOLOG TODAY · \$\{languageCode\.toUpperCase\(\)\}/);
  assert.doesNotMatch(html, /<small>TODAY<\/small>/);
  assert.doesNotMatch(html, /class="play-symbol"/);
  assert.match(css, /\.compact-overlay \{[^}]*width:\s*156px;\s*height:\s*42px/);
  assert.match(css, /\.expanded-window \{[^}]*width:\s*100%;\s*height:\s*100%;\s*margin:\s*0/);
  assert.match(css, /\.compact-overlay \{[^}]*box-shadow:\s*none/);
  assert.match(css, /\.compact-overlay > i\.is-passive \{\s*background:\s*var\(--orange\)/);
  assert.match(main, /width:\s*156,\s*height:\s*42/);
  assert.doesNotMatch(html, /compactOverlay[^]*›/);
  assert.match(main, /hasShadow:\s*false/);
  assert.match(main, /roundedCorners:\s*false/);
  assert.match(main, /function hideToTray\(\)/);
  assert.match(main, /new Tray\(icon\)/);
  assert.match(main, /installMpvAutoLauncher/);
  assert.match(renderer, /windowAction\("compact"\)/);
  assert.match(renderer, /windowAction\("hide"\)/);
  assert.match(renderer, /windowAction\("move"/);
  assert.match(main, /latestState\.fullscreen && mainWindow\.isVisible\(\)/);
  assert.match(renderer, /"Tracking now"/);
  assert.match(renderer, /"Playback paused"/);
  assert.match(renderer, /"Ready to track"/);
  assert.match(renderer, /saved for future MPV sessions/);
  assert.match(renderer, /`\$\{value\}s`/);
  assert.match(renderer, /`\$\{hours\}h \$\{String\(minutes\)\.padStart\(2, "0"\)\}m`/);
});

test("lifecycle controls expose auto-start and in-place sync without technical path fields", () => {
  const html = read("index.html");
  const preload = read("preload.js");
  const renderer = read("renderer.js");
  const main = read("main.js");

  assert.match(html, /id="runOnlyWithMpvToggle"/);
  assert.match(html, /Automatically open when MPV opens/);
  assert.match(html, /id="autoLaunchDescription"/);
  assert.match(html, /id="updateStatus"/);
  assert.match(html, /id="syncNowButton"[^>]*>Sync now<\/button>/);
  assert.doesNotMatch(html, /MPV path|configuration folder/);
  assert.match(preload, /setRunOnlyWithMpv/);
  assert.match(preload, /syncNow/);
  assert.match(renderer, /companionApi\.setRunOnlyWithMpv\(toggle\.checked\)/);
  assert.match(renderer, /companionApi\.syncNow\(\)/);
  assert.match(main, /syncWithChrome/);
  assert.match(main, /createAutoUpdateController/);
  assert.match(renderer, /Portable version · download updates manually/);
  assert.match(renderer, /restart required/);
  assert.match(renderer, /Closing × only hides Companion/);
});

test("before-connection UI automatically discovers Osmolog without exposing extension IDs", () => {
  const html = read("index.html");
  const renderer = read("renderer.js");
  const transport = fs.readFileSync(path.join(__dirname, "../src/transport/websocket-server.js"), "utf8");
  const service = fs.readFileSync(path.join(__dirname, "../src/service.js"), "utf8");

  assert.match(html, /Open Osmolog/);
  assert.doesNotMatch(html, /extensionIdInput|Chrome extension ID/);
  assert.match(renderer, /Connected — waiting for a player/);
  assert.match(renderer, /current\.mpvConnected && !current\.manatanConnected/);
  assert.match(renderer, /state\.player === "manatan"/);
  assert.match(renderer, /title: "Reconnecting to Osmolog…"/);
  assert.match(renderer, /the dashboard does not need to be open/);
  assert.match(renderer, /title: "Connect Osmolog once"/);
  assert.match(renderer, /button: "Open Osmolog"/);
  assert.match(renderer, /const connected = state\.extensionConnected === true/);
  assert.match(renderer, /companionApi\.openDashboard\(\)/);
  assert.match(service, /dashboardUrl\(view = "settings"\)/);
  assert.ok(transport.includes("chrome-extension:\\/\\/([a-p]{32})"));
  assert.match(transport, /startPairing\(durationMs = 60000\)/);
  assert.match(service, /startPairing\(5 \* 60 \* 1000\)/);
});
