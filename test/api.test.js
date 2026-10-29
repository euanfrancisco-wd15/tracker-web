"use strict";
// End-to-end API tests: starts the real server on a random port. Run: node --test
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server");
const isLoopback = (host) => {
  try {
    const url = new URL(/^https?:\/\//i.test(host) ? host : `http://${host}`);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
};
const emulatorsConfigured = isLoopback(process.env.FIRESTORE_EMULATOR_HOST || "")
  && isLoopback(process.env.FIREBASE_STORAGE_EMULATOR_HOST || "");
const integrationSkip = emulatorsConfigured ? false : "Set both Firebase emulator hosts to loopback addresses to run integration tests safely.";
const integration = (name, callback) => test(name, { skip: integrationSkip }, callback);

async function setup() {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (!emulatorsConfigured) throw new Error("Integration tests require Firestore and Storage emulator hosts on loopback.");
  const projectId = process.env.FIREBASE_PROJECT_ID || "demo-process-tracker";
  const emulatorUrl = /^https?:\/\//i.test(emulator) ? emulator : `http://${emulator}`;
  const reset = await fetch(`${emulatorUrl}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  if (!reset.ok) throw new Error(`Could not reset the Firestore emulator (HTTP ${reset.status}).`);
  const app = createApp({ seedDemo: false, adminPassword: "test-password-1" });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = "";
  const web = async (method, url, body, raw) => {
    const headers = cookie ? { cookie } : {};
    let payload;
    if (raw) payload = raw; else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const r = await fetch(base + url, { method, headers, body: payload });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null; try { json = JSON.parse(buf.toString()); } catch (_) { /* binary */ }
    return { status: r.status, json, buf };
  };
  const ctx = { app, web, base, token: "" };
  ctx.done = async () => { await app.close(); };
  ctx.esp = async (method, url, body, token = ctx.token) => {
    const r = await fetch(base + url, { method, headers: { "X-Device-Token": token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  };
  ctx.tap = async (uid) => (await ctx.esp("POST", "/api/v1/tap", { uid, photoId: "PH-1" })).json;
  ctx.act = async (name, session, job, extra = {}) => (await ctx.esp("POST", `/api/v1/job/${name}`, { session, job, ...extra })).json;
  ctx.job = async (no) => (await web("GET", `/api/jobs/${no}`)).json.job;
  ctx.setStage = async (stage) => {
    const tid = (await web("GET", "/api/terminals")).json.terminals[0].id;
    assert.equal((await web("PATCH", `/api/terminals/${tid}`, { stage })).status, 200);
  };
  try {
    assert.equal((await web("POST", "/api/login", { username: "manager", password: "test-password-1" })).status, 200);
    ctx.token = (await web("POST", "/api/terminals", { name: "Terminal 1", stage: "FABRICATION" })).json.token;
    for (const [name, uid, stage] of [["Juan", "01:02:03:04", "FABRICATION"], ["Maria", "11:22:33:44", "TECHNICAL"], ["Pedro", "55:66:77:88", "DELIVERY"]])
      assert.equal((await web("POST", "/api/employees", { name, rfid_uid: uid, stage })).status, 201);
    await web("POST", "/api/jobs", { equipment_type: "Prep Table" });
    await web("POST", "/api/jobs", { equipment_type: "Fridge Cabinet", needs_tech: "on" });
    return ctx;
  } catch (error) {
    await ctx.done();
    throw error;
  }
}

after(async () => {
  const { getApps } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  for (const app of getApps()) await getFirestore(app).terminate();
});

integration("auth is required everywhere", async () => {
  const c = await setup();
  try {
    assert.equal((await fetch(c.base + "/api/overview")).status, 401);
    assert.equal((await c.esp("GET", "/api/v1/terminal/config", undefined, "")).status, 401);
    assert.equal((await c.esp("GET", "/api/v1/terminal/config", undefined, "nope")).status, 401);
    assert.equal((await fetch(c.base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "manager", password: "x" }) })).status, 401);
    assert.equal((await fetch(c.base + "/")).status, 200);
    assert.equal((await fetch(c.base + "/../server.js")).status, 404);
  } finally { await c.done(); }
});

integration("terminal stage follows the web toggle", async () => {
  const c = await setup();
  try {
    assert.equal((await c.esp("GET", "/api/v1/terminal/config")).json.terminal.stage, "FABRICATION");
    await c.setStage("TECHNICAL");
    assert.equal((await c.esp("GET", "/api/v1/terminal/config")).json.terminal.stage, "TECHNICAL");
  } finally { await c.done(); }
});

integration("card checks", async () => {
  const c = await setup();
  try {
    assert.equal((await c.tap("AA:BB:CC:DD")).reason, "INVALID_CARD");
    assert.equal((await c.tap("11:22:33:44")).reason, "WRONG_STAGE");
    assert.ok((await c.tap("01020304")).ok);                      // no colons still works
    assert.equal((await c.web("GET", "/api/unregistered-cards")).json.cards[0].uid, "AA:BB:CC:DD");
  } finally { await c.done(); }
});

integration("full route through Technical to Delivery", async () => {
  const c = await setup();
  try {
    const s = (await c.tap("01:02:03:04")).session;
    assert.ok((await c.act("start", s, 1002)).ok);
    assert.ok((await c.act("status", s, 1002, { status: "REWORK" })).ok);
    assert.equal((await c.job(1002)).label, "Rework");
    assert.equal((await c.act("complete", s, 1002)).released_to, "TECHNICAL");
    assert.equal((await c.job(1002)).stage, "TECHNICAL");
    assert.equal((await c.act("start", s, 1002)).reason, "ALREADY_PASSED");
    await c.setStage("TECHNICAL");
    assert.equal((await c.act("start", s, 1002)).reason, "SESSION_EXPIRED");   // stage change signs the operator out
    const s2 = (await c.tap("11:22:33:44")).session;
    const queue = (await c.esp("GET", `/api/v1/queue?session=${s2}`)).json.jobs;
    assert.deepEqual(queue.map((j) => j.job_no), [1002]);
    assert.equal((await c.act("start", s2, 1001)).reason, "NOT_REQUIRED");
    assert.ok((await c.act("start", s2, 1002)).ok);
    assert.equal((await c.act("complete", s2, 1002)).released_to, "DELIVERY");
    await c.setStage("DELIVERY");
    const s3 = (await c.tap("55:66:77:88")).session;
    assert.ok((await c.act("start", s3, 1002)).ok);
    assert.ok((await c.act("complete", s3, 1002)).done);
    assert.equal((await c.job(1002)).state, "DONE");
    assert.equal((await c.act("start", s3, 1002)).reason, "JOB_CLOSED");
  } finally { await c.done(); }
});

integration("skipping Technical goes straight to Delivery", async () => {
  const c = await setup();
  try {
    const s = (await c.tap("01:02:03:04")).session;
    await c.act("start", s, 1001);
    assert.equal((await c.act("complete", s, 1001)).released_to, "DELIVERY");
  } finally { await c.done(); }
});

integration("rejections", async () => {
  const c = await setup();
  try {
    const s = (await c.tap("01:02:03:04")).session;
    assert.equal((await c.act("start", s, 9999)).reason, "JOB_NOT_FOUND");
    assert.equal((await c.act("complete", s, 1001)).reason, "NOT_STARTED");
    await c.act("start", s, 1001);
    assert.equal((await c.act("start", s, 1001)).reason, "ALREADY_STARTED");
    assert.equal((await c.esp("POST", "/api/v1/job/status", { session: s, job: 1001, status: "BOGUS" })).status, 400);
    assert.equal((await c.act("start", "bad-session", 1001)).reason, "SESSION_EXPIRED");
  } finally { await c.done(); }
});

integration("manager controls", async () => {
  const c = await setup();
  try {
    const s = (await c.tap("01:02:03:04")).session;
    await c.web("POST", "/api/jobs/1001/action", { action: "hold" });
    assert.equal((await c.act("start", s, 1001)).reason, "JOB_HELD");
    assert.equal((await c.job(1001)).label, "Held by manager");
    await c.web("POST", "/api/jobs/1001/action", { action: "resume" });
    assert.ok((await c.act("start", s, 1001)).ok);
    await c.web("POST", "/api/jobs/1001/action", { action: "release" });
    assert.equal((await c.job(1001)).stage, "DELIVERY");
    await c.web("POST", "/api/jobs/1002/action", { action: "cancel" });
    assert.equal((await c.job(1002)).state, "CANCELLED");
    assert.equal((await c.web("POST", "/api/jobs/1002/action", { action: "hold" })).status, 400);
    assert.equal((await c.web("PATCH", "/api/jobs/1001", { needs_tech: true })).status, 400);
  } finally { await c.done(); }
});

integration("employees and deactivation", async () => {
  const c = await setup();
  try {
    assert.equal((await c.web("POST", "/api/employees", { name: "Dup", rfid_uid: "01:02:03:04", stage: "FABRICATION" })).status, 409);
    assert.equal((await c.web("POST", "/api/employees", { name: "Bad", rfid_uid: "xyz", stage: "FABRICATION" })).status, 400);
    const s = (await c.tap("01:02:03:04")).session;
    const juan = (await c.web("GET", "/api/employees")).json.employees.find((e) => e.name === "Juan");
    assert.ok(juan.last_login);
    await c.web("PATCH", `/api/employees/${juan.id}`, { active: false });
    assert.equal((await c.act("start", s, 1001)).reason, "SESSION_EXPIRED");
    assert.equal((await c.tap("01:02:03:04")).reason, "EMPLOYEE_INACTIVE");
  } finally { await c.done(); }
});

integration("overview, activity log and CAD upload", async () => {
  const c = await setup();
  try {
    const s = (await c.tap("01:02:03:04")).session;
    await c.act("start", s, 1001);
    const ov = (await c.web("GET", "/api/overview")).json;
    assert.ok(ov.terminals[0].online);
    assert.equal(ov.terminals[0].operator, "Juan");
    assert.equal(ov.jobs.length, 2);
    assert.ok((await c.web("GET", "/api/events?q=1001")).json.events.length >= 2);

    const multipart = (name, bytes) => {
      const b = "----t" + Date.now();
      const body = Buffer.concat([
        Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="equipment_type"\r\n\r\nHood\r\n`),
        Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="cad"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        bytes, Buffer.from(`\r\n--${b}--\r\n`)]);
      return { body, type: `multipart/form-data; boundary=${b}` };
    };
    const send = async (m) => {
      const r = await fetch(c.base + "/api/jobs", { method: "POST", headers: { cookie: (await loginCookie(c)), "content-type": m.type }, body: m.body });
      return { status: r.status, json: await r.json() };
    };
    const pdf = Buffer.from("%PDF-1.4 test\r\n\r\nbinary\x00\xff");
    const up = await send(multipart("hood design.pdf", pdf));
    assert.equal(up.status, 201);
    const dl = await c.web("GET", `/api/jobs/${up.json.job_no}/cad`);
    assert.equal(dl.status, 200);
    assert.deepEqual(dl.buf, pdf);
    assert.equal((await send(multipart("evil.exe", Buffer.from("x")))).status, 400);
  } finally { await c.done(); }
});

async function loginCookie(c) {
  const r = await fetch(c.base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "manager", password: "test-password-1" }) });
  return r.headers.get("set-cookie").split(";")[0];
}

integration("token reset and password change", async () => {
  const c = await setup();
  try {
    const tid = (await c.web("GET", "/api/terminals")).json.terminals[0].id;
    const fresh = (await c.web("POST", `/api/terminals/${tid}/token`)).json.token;
    assert.equal((await c.esp("GET", "/api/v1/terminal/config")).status, 401);
    assert.equal((await c.esp("GET", "/api/v1/terminal/config", undefined, fresh)).status, 200);
    assert.equal((await c.web("POST", "/api/password", { current: "wrong", new: "long-enough-1" })).status, 400);
    assert.equal((await c.web("POST", "/api/password", { current: "test-password-1", new: "short" })).status, 400);
    assert.equal((await c.web("POST", "/api/password", { current: "test-password-1", new: "long-enough-1" })).status, 200);
    await c.web("POST", "/api/logout");
    assert.equal((await c.web("GET", "/api/me")).status, 401);
  } finally { await c.done(); }
});
