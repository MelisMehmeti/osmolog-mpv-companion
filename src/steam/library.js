"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

// Steam's local KeyValues files are data, never executable input. Keep parsing
// bounded and use dictionaries without prototypes for arbitrary manifest keys.
function parseVdf(text) {
  if (typeof text !== "string" || text.length > 4 * 1024 * 1024) throw new Error("Steam file is too large.");
  const tokens = text.match(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|[{}]|[^\s{}"]+/g) || [];
  let index = 0;
  const next = () => {
    while (tokens[index]?.startsWith("//")) index++;
    const token = tokens[index++];
    return token?.startsWith('"') ? token.slice(1, -1).replace(/\\([\\"])/g, "$1") : token;
  };
  function object(depth = 0) {
    if (depth > 32) throw new Error("Steam file nesting is too deep.");
    const value = Object.create(null);
    while (index < tokens.length) {
      const key = next();
      if (key === "}" && depth) return value;
      if (key === undefined && !depth) return value;
      if (!key || key === "{" || key === "}") throw new Error("Invalid Steam file.");
      const item = next();
      if (item === undefined || item === "}") throw new Error("Incomplete Steam file.");
      value[key.toLowerCase()] = item === "{" ? object(depth + 1) : item;
    }
    if (depth) throw new Error("Incomplete Steam file.");
    return value;
  }
  return object();
}

const STEAM_LANGUAGES = Object.freeze({
  arabic: "ar", bulgarian: "bg", schinese: "zh", tchinese: "zh", czech: "cs",
  danish: "da", dutch: "nl", english: "en", finnish: "fi", french: "fr",
  german: "de", greek: "el", hungarian: "hu", indonesian: "id", italian: "it",
  japanese: "ja", koreana: "ko", korean: "ko", norwegian: "no", polish: "pl",
  portuguese: "pt", brazilian: "pt", romanian: "ro", russian: "ru", spanish: "es",
  latam: "es", swedish: "sv", thai: "th", turkish: "tr", ukrainian: "uk", vietnamese: "vi"
});
const appId = value => /^[1-9]\d{0,9}$/.test(String(value || "")) ? String(value) : "";
const steamLanguage = value => STEAM_LANGUAGES[String(value || "").toLowerCase()] || "";

function containsPath(directory, file) {
  const relative = path.win32.relative(path.win32.resolve(directory), path.win32.resolve(file));
  return Boolean(relative) && relative !== ".." && !relative.startsWith("..\\") && !path.win32.isAbsolute(relative);
}

async function readVdf(file) {
  const stat = await fs.stat(file);
  if (stat.size > 4 * 1024 * 1024) throw new Error("Steam file is too large.");
  return parseVdf(await fs.readFile(file, "utf8"));
}

async function discoverSteamPath(environment = process.env) {
  if (process.platform !== "win32") return "";
  const registered = await new Promise(resolve => {
    execFile("reg.exe", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"],
      { windowsHide: true, timeout: 3000, maxBuffer: 32768 }, (error, stdout) => {
        resolve(error ? "" : /SteamPath\s+REG_SZ\s+(.+)/i.exec(stdout)?.[1]?.trim() || "");
      });
  });
  const candidates = [registered, path.win32.join(environment["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam")];
  for (const candidate of candidates.filter(Boolean)) {
    try { if ((await fs.stat(path.join(candidate, "steamapps"))).isDirectory()) return candidate; } catch { /* try next */ }
  }
  return "";
}

async function loadLibrary(steamPath) {
  const folders = new Set([steamPath]);
  try {
    const config = await readVdf(path.join(steamPath, "steamapps", "libraryfolders.vdf"));
    for (const [key, value] of Object.entries(config.libraryfolders || {})) {
      const folder = typeof value === "string" ? value : value?.path;
      if (/^\d+$/.test(key) && typeof folder === "string" && path.win32.isAbsolute(folder)) folders.add(folder);
    }
  } catch { /* The primary library remains usable. */ }
  const games = [];
  for (const folder of [...folders].slice(0, 32)) {
    const directory = path.join(folder, "steamapps");
    let files;
    try { files = await fs.readdir(directory); } catch { continue; }
    for (const file of files.filter(name => /^appmanifest_[1-9]\d{0,9}\.acf$/i.test(name)).slice(0, 10000)) {
      try {
        const manifest = (await readVdf(path.join(directory, file))).appstate;
        const id = appId(manifest?.appid);
        const installName = manifest?.installdir;
        if (!id || file.toLowerCase() !== `appmanifest_${id}.acf` || typeof installName !== "string" ||
          !installName || /[\\/:]/.test(installName) || [".", ".."].includes(installName)) continue;
        games.push({ appId: id, title: String(manifest.name || `Steam game ${id}`).replace(/[\x00-\x1f]/g, " ").slice(0, 160),
          installPath: path.win32.join(directory, "common", installName),
          configuredLanguage: steamLanguage(manifest.userconfig?.language) });
      } catch { /* Steam may be replacing a manifest during an update. Retry next scan. */ }
    }
  }
  return games;
}

module.exports = { parseVdf, appId, steamLanguage, containsPath, discoverSteamPath, loadLibrary };
