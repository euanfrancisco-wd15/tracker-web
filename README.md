# Process Tracker: Express, Firestore, React and ESP32 API

This version uses an Express backend, Firebase Admin SDK / Cloud Firestore, and a Vite React SPA in `frontend/`. It no longer reads or writes SQLite. Configure `FIREBASE_PROJECT_ID` plus Application Default Credentials (or `GOOGLE_APPLICATION_CREDENTIALS`) before starting it.

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run build
npm.cmd start
```

## Project layout

```
backend/       Express routes, Firestore repository, and process rules
frontend/      Vite React SPA (manager console and /sim)
esp32/         ESP32 firmware; its /api/v1 contract is unchanged
test/          API tests (configure the Firestore emulator before running)
server.js      Thin production entrypoint for backend/server.js
```

The website for the IoT kitchen-equipment process tracker. It does three jobs:

1. **Manager console** (a web page that also works on a phone): see every job on the line, hold or release jobs, add employees and cards, and choose which stage each terminal works as.
2. **Device API** for the ESP32 terminals: card tap, job start, status update, complete.
3. **Database and activity log**: every action is saved with the server's clock.

The single-terminal idea from your notes is built in: **one terminal firmware, and the stage is chosen on the website.** The ESP32 asks the server "which stage am I?" every few seconds, so you can switch one board between Fabrication, Technical / Refrigeration and Polishing without touching the code. Polishing retains the internal `DELIVERY` stage key for compatibility with existing jobs and terminals.

## Run it on your computer (VS Code)

1. You need **Node.js 22.13 or newer** (check with `node -v`). Open this folder in VS Code (File > Open Folder).
2. Open a terminal in VS Code (Terminal > New Terminal), install dependencies once, then run:

   ```
   npm.cmd install
   npm.cmd run dev
   ```

   The development command starts Vite on port 5173 and Express on port 5000. Open the Vite URL printed in the terminal. For a production-style local run, use `npm.cmd run build` followed by `npm.cmd start` and open port 5000.

3. Open http://localhost:5000 and sign in with **manager / changeme123**. Change the password under Account.
4. For a seeded terminal, sign in and use **Terminals > Issue new token**. The server stores only a token hash and returns the replacement once, in the manager interface. Save it before closing the reveal dialog.

The first run also adds demo data (three employees, three jobs, one terminal) that matches the Wokwi simulation: Juan `01:02:03:04` (Fabrication), Maria `11:22:33:44` (Technical), Pedro `55:66:77:88` (Polishing). To start empty, set `SEED_DEMO=0` before the first run. Data is stored in Firestore; manage or clear development data in the Firebase project or emulator, not by deleting a local `data` folder.

### Try it without any hardware

Open `http://localhost:5173/sim` while developing (or `http://localhost:5000/sim` after a production build), paste the device token, and use the buttons. It is a **virtual terminal** that calls the same device API the ESP32 will use. Keep the line board open in another window and watch it update.

## How the ESP32 connects to the website

There is nothing special to install on the server side. The ESP32 joins Wi-Fi and sends ordinary HTTP requests (the same kind a browser sends) to the server. The server answers with JSON that the ESP32 shows on the LCD.

```
RFID tap -> ESP32 --HTTP request--> server (this project) --> database
                  <--JSON reply----        |
                                           +--> manager's browser / phone
```

- Every request carries a header `X-Device-Token: tk_...`. The token identifies which terminal is calling. Each terminal has its own, and you can replace it from the website.
- The server decides everything (is the card valid, is it the right stage, is the job released). The ESP32 only sends what happened and shows the reply. This is the "server-authoritative" design in your Chapter 2.
- `esp32/terminal/terminal.ino` is your combined RFID terminal sketch (same pins and wiring: RC522, 16x2 I2C LCD, 4x4 keypad, 3 LEDs) rewritten so the job table, card list and stage live on this server instead of on the board. Configure `WIFI_SSID`, `WIFI_PASS`, `SERVER_URL` (your computer's address, not `localhost`) and the one-time `DEVICE_TOKEN` in your local sketch before flashing. Do not commit Wi-Fi credentials or device tokens. It has not been run on a board yet, so test it on yours. Libraries: MFRC522, Keypad, hd44780 and ArduinoJson 7.

### Device API

| Call | Purpose | Body |
|---|---|---|
| `GET /api/v1/terminal/config` | Which stage am I? Also counts as a heartbeat. | |
| `POST /api/v1/tap` | Card tapped. Returns a `session` if the card is valid for this terminal's stage. | `{"uid":"01:02:03:04","photoId":"..."}` |
| `GET /api/v1/queue?session=...` | Jobs waiting at this stage (for the LCD list). | |
| `POST /api/v1/job/start` | Start a job. | `{"session":"...","job":1001}` |
| `POST /api/v1/job/status` | `IN_PROGRESS`, `ON_HOLD`, `REWORK` or `WAIT_PARTS`. | `{"session":"...","job":1001,"status":"REWORK"}` |
| `POST /api/v1/job/complete` | Finish this stage and release the job to the next one. | `{"session":"...","job":1001}` |
| `POST /api/v1/logout` | Sign the operator out. | `{"session":"..."}` |

Replies always contain `ok: true/false`. When a check fails, `reason` is a code (`WRONG_STAGE`, `INVALID_CARD`, `NOT_RELEASED`, `JOB_HELD`, ...) and `message` is text you can print on the LCD. Operators are signed out after 10 idle minutes, or when the manager changes the terminal's stage.

### Job routing

Fabrication, then Technical / Refrigeration, then Polishing. Polishing uses the existing internal `DELIVERY` stage key. Each job has a "needs Technical" setting, chosen when the job is created. If it is off, completing Fabrication sends the job straight to Polishing. A terminal can only start a job that has been released to its stage, so the handoff between stages is enforced by the server.

## Put it in the cloud

The ESP32 and your phone can only reach `localhost` from the same computer, so for the demo you either keep everything on one Wi-Fi network (use your computer's address, for example `http://192.168.1.20:5000`), or deploy it so it has a public address.

Any host that can run Node 22.13 or newer works (Render, Railway, Fly.io, a VPS). The start command is:

```
npm start
```

Settings to give the host (as environment variables):

| Variable | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | Firebase project used by the Admin SDK. |
| `FIREBASE_STORAGE_BUCKET` | Private Storage bucket used for uploaded design files. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Optional path to service-account credentials; Application Default Credentials are also supported. |
| `ADMIN_PASSWORD` | The first manager password (only used when the database is empty). |
| `COOKIE_SECURE` | `1` once the site is served over HTTPS. |
| `SEED_DEMO` | `0` to skip the demo data. |

Things to check on the host you pick:

- **Firebase access.** Grant the Admin SDK access to Firestore and the configured Storage bucket. Uploaded design files are private and can only be downloaded through the authenticated manager API.
- **Sleeping.** Some free plans pause the app when idle, so the first request is slow. Set the ESP32's request timeout to match, or use a plan that stays awake for the demo day.
- **HTTPS.** Your paper requires TLS 1.2 or higher. On the ESP32 that means `WiFiClientSecure`, either with the host's root certificate (correct) or `setInsecure()` (acceptable only for a quick test, and say so in the paper). Plain `http://` on the plant's local network is fine for the prototype.

## Phone use

Open the site on the phone and choose "Add to Home screen". It opens like an app and shows the same live board. This is a responsive web app, not a separate mobile app, which is consistent with Limitation 7 in your Chapter 1.

## Tests

The API integration tests deliberately refuse to run against a production Firestore project or Storage bucket. Start both Firebase emulators, then configure the test process and run the suite. For PowerShell:

```powershell
$env:FIREBASE_PROJECT_ID = "demo-process-tracker"
$env:FIREBASE_STORAGE_BUCKET = "demo-process-tracker.appspot.com"
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199"
npm test
```

The API tests cover manager login, terminal-stage changes, RFID authorization, production routing and transitions, manager controls, deactivation, activity, design-file upload/download, and token/password changes. Emulator data is cleared before each integration scenario.

## Files

```
server.js       Express routes for manager and device APIs
backend/        Firestore persistence, configuration, and production rules
frontend/       React website source (index.html, src/, vite.config.js)
esp32/terminal/ Arduino sketch for your ESP32-S3 terminal (talks to this server)
test/           automated tests
```

## Limits to know about

- Photos are not stored yet. The tap already accepts a `photoId`, and the log keeps it, so the camera can be added later with one upload endpoint.
- One manager account. Add roles if the panel asks for supervisors.
- Operator sessions are stored in Firestore. Login attempt limiting is not currently implemented.
- Photo capture/storage is not implemented. The firmware's camera function remains a placeholder; do not treat its photo ID as an uploaded image.
- Design uploads accept PDF, DWG, DXF, STEP, and common image files up to 25 MB. Configure a Firebase Storage bucket before using file uploads.
