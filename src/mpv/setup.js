"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const PIPE_SETTING = "input-ipc-server=\\\\.\\pipe\\osmolog-mpv";

function resolveMpvConfigDirectory({ configDirectory, executable, environment = process.env } = {}) {
  if (configDirectory) return configDirectory;
  if (!executable || !/^mpv(?:\.net)?\.(?:exe|com)$/i.test(path.basename(executable))) return "";
  const portable = path.join(path.dirname(executable), "portable_config");
  if (fs.existsSync(portable) && fs.statSync(portable).isDirectory()) return portable;
  return environment.APPDATA ? path.join(environment.APPDATA, /^mpv\.net\./i.test(path.basename(executable)) ? "mpv.net" : "mpv") : "";
}

function setupMpvConnection(options = {}) {
  try {
    const directory = resolveMpvConfigDirectory(options);
    if (!directory) return { ok: false, message: "Choose mpv.exe or mpv.net.exe to set up the connection." };
    const file = path.join(directory, "mpv.conf");
    let original = Buffer.alloc(0), exists = false;
    try { original = fs.readFileSync(file); exists = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (original.includes(0)) return { ok: false, message: "This MPV configuration uses an unsupported encoding. Your file was left unchanged." };
    const text = original.toString("utf8"), newline = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    let inProfile = false;
    const kept = [];
    for (const line of lines) {
      if (/^\s*\[/.test(line)) inProfile = true;
      if (/^\s*input-ipc-server\s*=/.test(line)) {
        if (inProfile) return { ok: false, message: "An MPV profile controls the connection setting. Your configuration was left unchanged; use the advanced setup instructions." };
        continue;
      }
      kept.push(line);
    }
    if (lines.filter(line => /^\s*input-ipc-server\s*=/.test(line)).length === 1 && lines.some(line => line.trim() === PIPE_SETTING)) {
      return { ok: true, directory, changed: false, message: "MPV is already set up. Restart MPV if it is not connected yet." };
    }
    const content = (text.startsWith("\uFEFF") ? "\uFEFF" : "") + PIPE_SETTING + newline + kept.join(newline);
    fs.mkdirSync(directory, { recursive: true });
    let backup = "";
    if (exists) {
      backup = `${file}.osmolog-backup-${randomUUID()}`;
      fs.writeFileSync(backup, original, { flag: "wx" });
    }
    const temporary = `${file}.osmolog-${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return { ok: true, directory, backup, changed: true, message: `MPV is set up. Close and reopen MPV to connect.${backup ? " Your previous configuration was backed up." : ""}` };
  } catch (error) {
    return { ok: false, message: `Could not save MPV setup: ${error.message}` };
  }
}

module.exports = { PIPE_SETTING, resolveMpvConfigDirectory, setupMpvConnection };
