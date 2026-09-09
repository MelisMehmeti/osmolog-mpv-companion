"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PendingJournal } = require("../src/journal/journal");

function temporaryJournal() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "osmolog-journal-"));
  return { directory, file: path.join(directory, "pending.jsonl"), draftFile: path.join(directory, "active-segment.json") };
}

function event(id = "event-1") {
  return { eventId: id, segmentStartedAt: Date.now() - 1000, segmentEndedAt: Date.now(), realSeconds: 1 };
}

test("journal replays unacknowledged events exactly once", () => {
  const files = temporaryJournal();
  const first = new PendingJournal(files);
  first.open();
  assert.equal(first.append(event()), true);
  assert.equal(first.append(event()), false);
  const second = new PendingJournal(files);
  assert.equal(second.open().length, 1);
  assert.equal(second.acknowledge("event-1"), true);
  const third = new PendingJournal(files);
  assert.equal(third.open().length, 0);
});

test("an in-progress draft survives a hard-stop simulation", () => {
  const files = temporaryJournal();
  const first = new PendingJournal(files);
  first.open();
  first.saveDraft(event("draft-event"));
  const restarted = new PendingJournal(files);
  restarted.open();
  const recovered = restarted.consumeDraft();
  assert.equal(recovered.eventId, "draft-event");
  assert(fs.existsSync(files.draftFile), "reading a draft cannot delete the only durable copy before journal append");
  restarted.append(recovered);
  restarted.clearDraft();
  assert.equal(restarted.list().length, 1);
});

test("unacknowledged playback survives age and capacity thresholds", () => {
  const files = temporaryJournal(), warnings = [];
  const journal = new PendingJournal({ ...files, maxBytes: 50, now: () => Date.now() + 365 * 86400000, onWarning: message => warnings.push(message) });
  journal.open();
  for (let i = 0; i < 30; i++) journal.append(event(`kept-${i}`));
  assert.equal(journal.list().length, 30);
  assert.equal(new PendingJournal({ ...files, now: () => Date.now() + 365 * 86400000 }).open().length, 30);
  assert.equal(warnings.length, 1, "large pending storage warns without deleting or repeating a warning every tick");
});

test("damaged journal content is retained before readable entries are compacted", () => {
  const files = temporaryJournal(), journal = new PendingJournal(files);
  journal.open(); journal.append(event("survivor"));
  fs.appendFileSync(files.file, '{"interrupted":');
  const original = fs.readFileSync(files.file, "utf8");
  assert.equal(new PendingJournal(files).open().length, 1);
  const preserved = fs.readdirSync(files.directory).find(name => name.startsWith("pending.jsonl.damaged-"));
  assert(preserved);
  assert.equal(fs.readFileSync(path.join(files.directory, preserved), "utf8"), original);
});

test("MPV and Manatan drafts survive independently", () => {
  const files = temporaryJournal();
  const journal = new PendingJournal(files);
  journal.open();
  journal.saveDraft({ ...event("mpv-draft"), player: "mpv" });
  journal.saveDraft({ ...event("manatan-draft"), player: "manatan" });
  assert.deepEqual(journal.consumeDrafts().map(value => value.eventId).sort(), ["manatan-draft", "mpv-draft"]);
});

test("a new checkpoint cannot overwrite the only damaged draft copy", () => {
  const files = temporaryJournal(), journal = new PendingJournal(files);
  journal.open();
  fs.writeFileSync(files.draftFile, '{"interrupted":');
  assert.equal(journal.consumeDraft(), null);
  journal.saveDraft(event("next-draft"));
  const preserved = fs.readdirSync(files.directory).find(name => name.startsWith("active-segment.json.damaged-"));
  assert(preserved);
  assert.equal(fs.readFileSync(path.join(files.directory, preserved), "utf8"), '{"interrupted":');
  assert.equal(journal.consumeDraft().eventId, "next-draft");
});
