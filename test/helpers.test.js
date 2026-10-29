"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUid } = require("../server");
const rules = require("../backend/rules");

test("RFID UIDs normalize only valid 4, 7, and 10 byte identifiers", () => {
  assert.equal(normalizeUid("01020304"), "01:02:03:04");
  assert.equal(normalizeUid("01:02:03:04"), "01:02:03:04");
  assert.equal(normalizeUid("01-02-03-04"), "01:02:03:04");
  assert.equal(normalizeUid("01 02 03 04"), "01:02:03:04");
  assert.equal(normalizeUid("11:22:33:44:55:66:77"), "11:22:33:44:55:66:77");
  assert.equal(normalizeUid("xyz01:02:03:04"), "");
  assert.equal(normalizeUid("01:02:03"), "");
  assert.equal(normalizeUid("01::02:03:04"), "");
});

test("job routing skips Technical only when the job does not require it", () => {
  assert.equal(rules.nextStage({ stage: "FABRICATION", needs_tech: true }), "TECHNICAL");
  assert.equal(rules.nextStage({ stage: "FABRICATION", needs_tech: false }), "DELIVERY");
  assert.equal(rules.nextStage({ stage: "TECHNICAL", needs_tech: true }), "DELIVERY");
  assert.equal(rules.nextStage({ stage: "DELIVERY", needs_tech: false }), null);
});

test("job API shape hides internal design-storage paths", () => {
  const job = rules.jobDict({
    job_no: 1001,
    stage: "FABRICATION",
    state: "QUEUED",
    needs_tech: false,
    held: false,
    status_text: "Ready",
    cad_path: "jobs/1001/private.pdf",
  });
  assert.equal(job.has_cad, true);
  assert.equal(Object.hasOwn(job, "cad_path"), false);
  assert.equal(job.label, "Waiting to start");
});
