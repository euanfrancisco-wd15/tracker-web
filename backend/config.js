"use strict";

// Load local development settings once. Production hosts should inject environment
// variables directly rather than committing a .env file.
require("dotenv").config({ path: process.env.ENV_FILE || ".env" });

const port = Number(process.env.PORT || 5000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");

module.exports = Object.freeze({
  port,
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || undefined,
  firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined,
  cookieSecure: process.env.COOKIE_SECURE === "1",
  seedDemo: process.env.SEED_DEMO !== "0",
});
