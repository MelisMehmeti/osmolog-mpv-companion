"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_BYTES = 10 * 1024 * 1024;

class PendingJournal {
  constructor(options = {}) {
    this.file = options.file;
    this.draftFile = options.draftFile || path.join(path.dirname(this.file), "active-segment.json");
    this.maxBytes = options.maxBytes || MAX_BYTES;
    this.now = options.now || Date.now;
    this.capacityWarningShown = false;
    this.pending = new Map();
    this.onWarning = options.onWarning || (() => {});
  }

  open() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, "");
    const acknowledged = new Set();
    const segments = new Map();
    let damaged = false;
    for (const line of fs.readFileSync(this.file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.op === "segment" && entry.event?.eventId) segments.set(entry.event.eventId, entry.event);
        if (entry.op === "ack" && entry.eventId) acknowledged.add(entry.eventId);
      } catch {
        damaged = true;
      }
    }
    if (damaged) {
      const retained = `${this.file}.damaged-${this.now()}`;
      fs.copyFileSync(this.file, retained);
      this.onWarning(`A damaged journal line was retained for recovery in ${path.basename(retained)}.`);
    }
    for (const [id, event] of segments) {
      if (!acknowledged.has(id)) this.pending.set(id, event);
    }
    this.compact();
    return this.list();
  }

  append(event) {
    if (!event?.eventId || this.pending.has(event.eventId)) return false;
    fs.appendFileSync(this.file, `${JSON.stringify({ op: "segment", event })}\n`, { flush: true });
    this.pending.set(event.eventId, event);
    this.enforceCap();
    return true;
  }

  acknowledge(eventId) {
    if (!this.pending.has(eventId)) return false;
    fs.appendFileSync(this.file, `${JSON.stringify({ op: "ack", eventId })}\n`, { flush: true });
    this.pending.delete(eventId);
    if (!this.pending.size) this.compact();
    return true;
  }

  list() {
    return [...this.pending.values()].sort((a, b) => a.segmentStartedAt - b.segmentStartedAt);
  }

  compact() {
    const body = this.list().map(event => JSON.stringify({ op: "segment", event })).join("\n");
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, body ? `${body}\n` : "", { flush: true });
    fs.renameSync(temporary, this.file);
  }

  enforceCap() {
    if (fs.statSync(this.file).size <= this.maxBytes) return;
    if (!this.capacityWarningShown) {
      this.capacityWarningShown = true;
      this.onWarning("The pending journal is large. All unacknowledged playback was kept; connect Chrome to finish saving it.");
      this.compact();
    }
  }

  saveDraft(draft) {
    const player = ["manatan", "steam"].includes(draft?.player) ? draft.player : "mpv";
    if (!draft) return this.clearDraft(player);
    const draftFile = this.draftPath(player);
    const temporary = `${draftFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(draft), { flush: true });
    fs.renameSync(temporary, draftFile);
  }

  draftPath(player = "mpv") {
    return ["manatan", "steam"].includes(player)
      ? path.join(path.dirname(this.draftFile), `active-segment-${player}.json`)
      : this.draftFile;
  }

  consumeDraft(player = "mpv") {
    const draftFile = this.draftPath(player);
    if (!fs.existsSync(draftFile)) return null;
    try {
      const value = JSON.parse(fs.readFileSync(draftFile, "utf8"));
      // The caller clears the draft only after append has durably succeeded.
      return value;
    } catch {
      const retained = `${draftFile}.damaged-${this.now()}`;
      fs.copyFileSync(draftFile, retained);
      this.onWarning(`The interrupted ${player} draft was retained for recovery in ${path.basename(retained)}.`);
      return null;
    }
  }

  consumeDrafts() {
    return [this.consumeDraft("mpv"), this.consumeDraft("manatan"), this.consumeDraft("steam")].filter(Boolean);
  }

  clearDraft(player = "mpv") {
    try { fs.unlinkSync(this.draftPath(player)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

module.exports = { MAX_BYTES, PendingJournal };
