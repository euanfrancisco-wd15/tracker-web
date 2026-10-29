"use strict";
// Firestore persistence and shared primitives. No SQLite files are opened by this app.
const crypto = require("node:crypto");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const config = require("./config");
const STAGES = ["FABRICATION", "TECHNICAL", "DELIVERY"];
const STAGE_LABEL = { FABRICATION: "Fabrication", TECHNICAL: "Technical / Refrigeration", DELIVERY: "Polishing" };
const now = () => new Date().toISOString();
const after = seconds => new Date(Date.now() + seconds * 1000).toISOString();
const secondsSince = iso => iso ? (Date.now() - Date.parse(iso)) / 1000 : null;
const hashToken = token => crypto.createHash("sha256").update(token).digest("hex");
const newToken = () => "tk_" + crypto.randomBytes(18).toString("hex");
function hashPassword(password) { const salt = crypto.randomBytes(16).toString("hex"); return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`; }
function checkPassword(password, stored) { const [kind, salt, value] = String(stored).split("$"); if (kind !== "scrypt" || !salt || !value) return false; const a = Buffer.from(value, "hex"), b = crypto.scryptSync(String(password), salt, 64); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function firestore() {
  // Firebase Admin v13+ exposes app lifecycle through getApps(), not admin.apps.
  if (!getApps().length) initializeApp(config.firebaseProjectId ? { projectId: config.firebaseProjectId } : undefined);
  return getFirestore();
}
function storageBucket() {
  firestore(); // ensures the Admin application has been initialized once.
  if (!config.firebaseStorageBucket) throw new Error("FIREBASE_STORAGE_BUCKET must be configured before uploading design files.");
  return getStorage().bucket(config.firebaseStorageBucket);
}
const doc = (collection, id) => firestore().collection(collection).doc(String(id));
async function findBy(collection, field, value) { const snap = await firestore().collection(collection).where(field, "==", value).limit(1).get(); return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }; }
async function nextId(collection, field, floor = 0) {
  const db = firestore();
  const counter = db.collection("sequences").doc(collection);
  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(counter);
    if (current.exists) {
      const id = Number(current.data().value) + 1;
      transaction.update(counter, { value: id });
      return id;
    }

    const latest = await transaction.get(db.collection(collection).orderBy(field, "desc").limit(1));
    const id = latest.empty ? floor + 1 : Number(latest.docs[0].data()[field]) + 1;
    transaction.set(counter, { value: id });
    return id;
  });
}
async function log(event, data = {}) { const id = firestore().collection("activity_logs").doc().id; await doc("activity_logs", id).set({ id, event, ts: now(), ...data }); }
async function seed({ seedDemo = process.env.SEED_DEMO !== "0", adminPassword } = {}) {
  if (!(await findBy("managers", "username", "manager"))) { await doc("managers", "manager").set({ id: "manager", username: "manager", password_hash: hashPassword(adminPassword || process.env.ADMIN_PASSWORD || "changeme123") }); console.log("[setup] Created manager account 'manager'."); }
  if (!seedDemo || !(await firestore().collection("jobs").limit(1).get()).empty) return;
  const t = now();
  for (const [id,name,rfid_uid,stage] of [["1","Juan","01:02:03:04","FABRICATION"],["2","Maria","11:22:33:44","TECHNICAL"],["3","Pedro","55:66:77:88","DELIVERY"]]) { await doc("employees",id).set({ id:Number(id),name,rfid_uid,stage,active:true,created_at:t }); await doc("cards",rfid_uid).set({ uid:rfid_uid,employee_id:Number(id) }); }
  for (const [job_no,equipment_type,needs_tech] of [[1001,"Prep Table",false],[1002,"Fridge Cabinet",true],[1003,"Sink Unit",false]]) await doc("jobs",job_no).set({ job_no,equipment_type,needs_tech,stage:"FABRICATION",state:"QUEUED",status_text:"Ready",held:false,created_at:t,stage_since:t,updated_at:t });
  const token = process.env.DEMO_DEVICE_TOKEN || newToken(); await doc("terminals","1").set({id:1,name:"Terminal 1",token_hash:hashToken(token),stage:"FABRICATION",active:true,created_at:t}); console.log("[setup] Seeded demo terminal. Issue a device token from the manager console.");
}
module.exports = { STAGES, STAGE_LABEL, now, after, secondsSince, hashToken, newToken, hashPassword, checkPassword, firestore, storageBucket, doc, findBy, nextId, log, seed };
