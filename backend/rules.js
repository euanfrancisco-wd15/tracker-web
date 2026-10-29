"use strict";

const { STAGES, STAGE_LABEL, now, doc } = require("./db");

function nextStage(job) {
  if (job.stage === "FABRICATION") return job.needs_tech ? "TECHNICAL" : "DELIVERY";
  if (job.stage === "TECHNICAL") return "DELIVERY";
  return null;
}

function checkJobRecord(job, stage, needState) {
  if (!job) return { reason: "JOB_NOT_FOUND", detail: "No job with that number" };
  if (job.state === "DONE") return { reason: "JOB_CLOSED", detail: "Job was already delivered" };
  if (job.state === "CANCELLED") return { reason: "JOB_CANCELLED", detail: "Job was cancelled" };
  if (job.held) return { reason: "JOB_HELD", detail: "Held by the production manager" };
  if (job.stage !== stage) {
    const here = STAGE_LABEL[job.stage];
    if (stage === "TECHNICAL" && job.stage === "FABRICATION" && !job.needs_tech)
      return { reason: "NOT_REQUIRED", detail: "This job skips Technical" };
    if (STAGES.indexOf(job.stage) < STAGES.indexOf(stage))
      return { reason: "NOT_RELEASED", detail: `Still at ${here}` };
    return { reason: "ALREADY_PASSED", detail: `Now at ${here}` };
  }
  if (job.state !== needState) {
    if (needState === "QUEUED")
      return { reason: "ALREADY_STARTED", detail: "Job is already in progress here" };
    return { reason: "NOT_STARTED", detail: "Start the job before this step" };
  }
  return { job };
}

async function checkJob(jobNo, stage, needState) {
  const snap = jobNo == null ? null : await doc("jobs", jobNo).get();
  return checkJobRecord(snap?.exists ? snap.data() : null, stage, needState);
}

async function advance(job) {
  const next = nextStage(job);
  const timestamp = now();
  await doc("jobs", job.job_no).update(next
    ? { stage: next, state: "QUEUED", status_text: "Released", stage_since: timestamp, updated_at: timestamp }
    : { state: "DONE", status_text: "Delivered", finished_at: timestamp, updated_at: timestamp });
  return next;
}

const WARN_STATUS = new Set(["On hold", "Rework", "Waiting for parts"]);

function jobDict(row) {
  const result = {
    ...row,
    needs_tech: !!row.needs_tech,
    held: !!row.held,
    stage_label: STAGE_LABEL[row.stage],
  };
  if (result.state === "DONE") [result.label, result.tone] = ["Delivered", "done"];
  else if (result.state === "CANCELLED") [result.label, result.tone] = ["Cancelled", "bad"];
  else if (result.held) [result.label, result.tone] = ["Held by manager", "warn"];
  else if (result.state === "QUEUED") [result.label, result.tone] = ["Waiting to start", "idle"];
  else [result.label, result.tone] = [result.status_text, WARN_STATUS.has(result.status_text) ? "warn" : "ok"];
  result.has_cad = !!(result.cad_file || result.cad_path || result.design_url);
  delete result.cad_file;
  delete result.cad_path;
  return result;
}

module.exports = { nextStage, checkJobRecord, checkJob, advance, jobDict };
