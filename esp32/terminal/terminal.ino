/*
 * GROUP 10 - RFID PRODUCTION TERMINAL (networked build)
 * Board : ESP32-S3 (Arduino IDE: "ESP32S3 Dev Module")
 * Parts : RC522 RFID, 16x2 I2C LCD, 4x4 membrane keypad, 3 LEDs   (same wiring as rfid_terminal_combined)
 *
 * WIRING (ESP32-S3 GPIO)
 *   RC522  : 3V3->3V3, GND->GND, RST->14, SDA(SS)->10, SCK->12, MOSI->11, MISO->13
 *   LCD I2C: GND->GND, VCC->5V, SDA->8, SCL->9
 *   Keypad : pins 1-4 (rows) -> 1,2,4,5   pins 5-8 (columns) -> 6,7,15,16
 *   LEDs   : GPIO17 green, GPIO18 amber, GPIO21 red (each through 220-330 ohm to GND)
 *
 * What changed from the standalone sketch: the job table, the card registry and the stage setting no
 * longer live on the board. The server (Node, this project) keeps them, so
 *   - the stage (Fabrication / Technical / Polishing) is chosen on the website,
 *   - cards are added on the website (Employees page),
 *   - every tap and job step is saved in the website's activity log.
 *
 * FLOW
 *   1. Tap card            -> server checks: known, active, card stage == terminal stage
 *   2. Type the job number -> keys 0-9, * = backspace, C = cancel
 *   3. Press #             -> first accepted # STARTS the job here, the next one COMPLETES it
 *                             (completing releases the job to the next stage on the server)
 *      or press A / B / D  -> status update on a job already started: A = Rework, B = On hold, D = Waiting parts
 *
 * LED: green = accepted | amber = waiting for input | red = rejected, blinks N times = code E<N>
 *   E1 unknown card   E2 card disabled   E3 wrong stage   E4 job not found   E5 job closed/cancelled
 *   E6 job not at this stage yet / already passed   E7 held by manager   E8 not started / already started / session ended
 *   E9 cannot reach the server
 *
 * Libraries (Library Manager): "MFRC522" (GithubCommunity), "Keypad" (Mark Stanley),
 *                              "hd44780" (Bill Perry), "ArduinoJson" (Benoit Blanchon, version 7)
 */

#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <MFRC522.h>
#include <Keypad.h>
#include <hd44780.h>
#include <hd44780ioClass/hd44780_I2Cexp.h>

// ======================= SETTINGS (edit these) =======================
const char* WIFI_SSID    = "FRANCISCO";
const char* WIFI_PASS    = "12345678";
// Same Wi-Fi as your computer: use the computer's address, NOT "localhost". Example: http://192.168.1.20:5000
// Cloud: use the https address, for example https://your-app.onrender.com
const char* SERVER_URL   = "http://192.168.68.117:5000";
const char* DEVICE_TOKEN = "tk_f2d84b42da2f98749a7c0dbbe4fb8be87cfd";
#define HTTPS_SKIP_CERT_CHECK 1   // 1 = quick test over https without checking the certificate (not for real use)
#define SWAP_ROWS_COLS        0   // set to 1 if keys come out transposed (press 2, see 4)

// ======================= PINS ==========================
#define RC522_SS    10
#define RC522_MOSI  11
#define RC522_SCK   12
#define RC522_MISO  13
#define RC522_RST   14
#define LCD_SDA      8
#define LCD_SCL      9
#define LED_GREEN   17
#define LED_AMBER   18
#define LED_RED     21

const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
#if SWAP_ROWS_COLS
  byte rowPins[ROWS] = {6, 7, 15, 16};
  byte colPins[COLS] = {1, 2, 4, 5};
#else
  byte rowPins[ROWS] = {1, 2, 4, 5};
  byte colPins[COLS] = {6, 7, 15, 16};
#endif

// ======================= TIMING ========================
const unsigned long RESULT_MS       = 2500;    // how long a result stays on screen
const unsigned long JOB_TIMEOUT_MS  = 20000;   // idle time allowed while typing the job number
const unsigned long CONFIG_EVERY_MS = 4000;    // how often the terminal asks the server for its stage
const unsigned long WIFI_RETRY_MS   = 10000;

// ======================= HARDWARE OBJECTS ==============
MFRC522 rfid(RC522_SS, RC522_RST);
hd44780_I2Cexp lcd;
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// ======================= STATE =========================
enum State { S_IDLE, S_WAIT_JOB, S_RESULT };
State state = S_IDLE;
String stageKey = "";          // FABRICATION / TECHNICAL / DELIVERY, set on the website
bool serverOk = false;         // last request reached the server
String sessionId = "";         // given by the server after a valid tap
String curName = "-";
String jobInput = "";
unsigned long stateStart = 0, lastConfig = 0, lastWifiTry = 0;

// ======================= HELPERS =======================
void lcdPrint(uint8_t row, String s) {
  if (s.length() > 16) s = s.substring(0, 16);
  while (s.length() < 16) s += ' ';
  lcd.setCursor(0, row);
  lcd.print(s);
}

void allLedsOff() {
  digitalWrite(LED_GREEN, LOW);
  digitalWrite(LED_AMBER, LOW);
  digitalWrite(LED_RED, LOW);
}

String uidToString(const MFRC522::Uid& u) {       // "01:02:03:04", the format the server expects
  String s = "";
  for (byte i = 0; i < u.size; i++) {
    if (i) s += ':';
    if (u.uidByte[i] < 0x10) s += '0';
    s += String(u.uidByte[i], HEX);
  }
  s.toUpperCase();
  return s;
}

bool readCard(String& uidOut) {
  if (!rfid.PICC_IsNewCardPresent()) return false;
  if (!rfid.PICC_ReadCardSerial()) return false;
  uidOut = uidToString(rfid.uid);
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  return true;
}

// Placeholder for the audit photo (a camera board can replace this later).
String capturePhoto() { return "NO-CAMERA"; }

String stageShort() {
  if (stageKey == "") return "NOT CONNECTED";
  return stageKey;                                 // FABRICATION / TECHNICAL / DELIVERY fit on 16 characters
}

// ======================= SERVER CALLS =======================
// Sends one request. Fills `doc` with the JSON reply. Returns false if the server could not be reached.
bool callApi(const char* method, const String& path, const String& body, JsonDocument& doc) {
  if (!SERVER_URL[0] || !DEVICE_TOKEN[0]) { serverOk = false; return false; }
  if (WiFi.status() != WL_CONNECTED) { serverOk = false; return false; }
  String url = String(SERVER_URL) + path;
  HTTPClient http;
  WiFiClientSecure secure;
  WiFiClient plain;
  bool ok;
  if (url.startsWith("https")) {
#if HTTPS_SKIP_CERT_CHECK
    secure.setInsecure();
#endif
    ok = http.begin(secure, url);
  } else {
    ok = http.begin(plain, url);
  }
  if (!ok) { serverOk = false; return false; }
  http.addHeader("X-Device-Token", DEVICE_TOKEN);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(6000);
  int code = (strcmp(method, "GET") == 0) ? http.GET() : http.POST(body);
  if (code <= 0) { http.end(); serverOk = false; return false; }
  DeserializationError err = deserializeJson(doc, http.getString());
  http.end();
  serverOk = !err;
  return !err;
}

// Asks the server which stage this terminal is set to. Also lets the website show the terminal as online.
void refreshConfig() {
  JsonDocument doc;
  if (callApi("GET", "/api/v1/terminal/config", "", doc) && (doc["ok"] | false)) {
    String s = doc["terminal"]["stage"].as<String>();
    if (s != stageKey) {
      stageKey = s;
      Serial.println("INFO,stage from website = " + stageKey);
      if (sessionId != "") { sessionId = ""; }      // the server signs the operator out when the stage changes
    }
  } else {
    if (serverOk) Serial.println("WARN,server refused the request (check DEVICE_TOKEN)");
    else Serial.println("WARN,server not reachable");
    stageKey = serverOk ? "BAD TOKEN" : stageKey;
  }
}

// ======================= SCREENS =======================
void drawIdle() {
  allLedsOff();
  if (WiFi.status() != WL_CONNECTED) {
    lcdPrint(0, "NO WIFI");
    lcdPrint(1, "Connecting...");
    return;
  }
  lcdPrint(0, String("STN: ") + stageShort());
  lcdPrint(1, serverOk ? "Tap RFID card" : "SERVER OFFLINE");
}

void drawJobPrompt() {
  lcdPrint(0, curName);
  lcdPrint(1, "Job: " + jobInput + "_");
}

void goIdle() {
  state = S_IDLE;
  sessionId = "";
  curName = "-";
  jobInput = "";
  drawIdle();
}

// Green = accepted. Red blinks <code> times (reason code) then stays on. amber = neutral notice.
void showResult(uint8_t code, const String& line0, const String& line1, bool amber = false) {
  lcdPrint(0, line0);
  lcdPrint(1, line1);
  allLedsOff();
  if (amber) {
    digitalWrite(LED_AMBER, HIGH);
  } else if (code == 0) {
    digitalWrite(LED_GREEN, HIGH);
  } else {
    for (uint8_t i = 0; i < code; i++) {
      digitalWrite(LED_RED, HIGH); delay(120);
      digitalWrite(LED_RED, LOW);  delay(120);
    }
    digitalWrite(LED_RED, HIGH);
  }
  state = S_RESULT;
  stateStart = millis();
}

// Server reason -> LED code and a short LCD text
uint8_t reasonCode(const String& r) {
  if (r == "INVALID_CARD") return 1;
  if (r == "EMPLOYEE_INACTIVE") return 2;
  if (r == "WRONG_STAGE") return 3;
  if (r == "JOB_NOT_FOUND") return 4;
  if (r == "JOB_CLOSED" || r == "JOB_CANCELLED") return 5;
  if (r == "NOT_RELEASED" || r == "NOT_REQUIRED" || r == "ALREADY_PASSED") return 6;
  if (r == "JOB_HELD") return 7;
  return 8;   // NOT_STARTED, ALREADY_STARTED, SESSION_EXPIRED, BAD_STATUS ...
}
String reasonText(const String& r) {
  if (r == "INVALID_CARD") return "UNKNOWN CARD";
  if (r == "EMPLOYEE_INACTIVE") return "CARD DISABLED";
  if (r == "WRONG_STAGE") return "WRONG STAGE";
  if (r == "JOB_NOT_FOUND") return "JOB NOT FOUND";
  if (r == "JOB_CLOSED") return "JOB CLOSED";
  if (r == "JOB_CANCELLED") return "JOB CANCELLED";
  if (r == "NOT_RELEASED") return "NOT RELEASED YET";
  if (r == "NOT_REQUIRED") return "STAGE NOT NEEDED";
  if (r == "ALREADY_PASSED") return "ALREADY PASSED";
  if (r == "JOB_HELD") return "HELD BY MANAGER";
  if (r == "NOT_STARTED") return "NOT STARTED";
  if (r == "ALREADY_STARTED") return "ALREADY STARTED";
  if (r == "SESSION_EXPIRED") return "SESSION ENDED";
  return "REJECTED";
}

void showOffline() {
  Serial.println("ERROR,server not reachable");
  showResult(9, "SERVER OFFLINE", "E9 Try again", false);
}

// ======================= ACTIONS =======================
void onCardTapped(const String& uid) {
  String photo = capturePhoto();
  JsonDocument doc;
  String body = "{\"uid\":\"" + uid + "\",\"photoId\":\"" + photo + "\"}";
  if (!callApi("POST", "/api/v1/tap", body, doc)) { showOffline(); return; }

  if (doc["ok"] | false) {
    sessionId = doc["session"].as<String>();
    curName = doc["employee"]["name"].as<String>();
    Serial.println("LOG,tap,ACCEPT," + curName + "," + uid);
    state = S_WAIT_JOB;
    jobInput = "";
    stateStart = millis();
    allLedsOff();
    digitalWrite(LED_AMBER, HIGH);
    drawJobPrompt();
    return;
  }
  String reason = doc["reason"].as<String>();
  Serial.println("LOG,tap,REJECT," + reason + "," + uid);
  uint8_t code = reasonCode(reason);
  String detail = doc["message"].as<String>();
  showResult(code, reasonText(reason), "E" + String(code) + " " + detail);
}

// Result of a job request. Returns true when accepted.
bool showJobReply(JsonDocument& doc, const String& okLine0, const String& okLine1) {
  if (doc["ok"] | false) {
    showResult(0, okLine0, okLine1);
    return true;
  }
  String reason = doc["reason"].as<String>();
  uint8_t code = reasonCode(reason);
  showResult(code, reasonText(reason), "E" + String(code) + " Job " + jobInput);
  return false;
}

// '#': try to start the job; if it is already started here, complete it instead.
void submitJob() {
  if (jobInput.length() == 0) return;
  JsonDocument doc;
  String body = "{\"session\":\"" + sessionId + "\",\"job\":" + jobInput + "}";
  if (!callApi("POST", "/api/v1/job/start", body, doc)) { showOffline(); return; }
  if (doc["ok"] | false) {
    Serial.println("LOG,start,ACCEPT," + jobInput);
    showResult(0, "STAGE STARTED", "Job " + jobInput);
    return;
  }
  if (doc["reason"].as<String>() == "ALREADY_STARTED") {
    JsonDocument doc2;
    if (!callApi("POST", "/api/v1/job/complete", body, doc2)) { showOffline(); return; }
    if (doc2["ok"] | false) {
      Serial.println("LOG,complete,ACCEPT," + jobInput);
      String next = doc2["done"] | false ? "DELIVERED" : "RELEASED";
      showResult(0, "STAGE COMPLETE", next + " " + jobInput);
    } else {
      showJobReply(doc2, "", "");
    }
    return;
  }
  Serial.println("LOG,start,REJECT," + doc["reason"].as<String>() + "," + jobInput);
  showJobReply(doc, "", "");
}

void submitStatus(const char* status, const char* label) {
  if (jobInput.length() == 0) return;
  JsonDocument doc;
  String body = "{\"session\":\"" + sessionId + "\",\"job\":" + jobInput + ",\"status\":\"" + status + "\",\"photoId\":\"" + capturePhoto() + "\"}";
  if (!callApi("POST", "/api/v1/job/status", body, doc)) { showOffline(); return; }
  showJobReply(doc, "STATUS SAVED", String(label));
}

// ======================= STATE HANDLERS =======================
void handleIdle(char key) {
  (void)key;
  if (millis() - lastConfig > CONFIG_EVERY_MS) {
    lastConfig = millis();
    bool before = serverOk;
    String beforeStage = stageKey;
    refreshConfig();
    if (before != serverOk || beforeStage != stageKey) drawIdle();
  }
  if (!serverOk) return;                           // do not read cards while the server cannot answer
  String uid;
  if (readCard(uid)) onCardTapped(uid);
}

void handleWaitJob(char key) {
  if (millis() - stateStart > JOB_TIMEOUT_MS) {
    showResult(0, "TIMED OUT", "Tap card again", true);
    return;
  }
  if (!key) return;
  stateStart = millis();

  if (key >= '0' && key <= '9') {
    if (jobInput.length() < 6) jobInput += key;
    drawJobPrompt();
  } else if (key == '*') {
    if (jobInput.length() > 0) jobInput.remove(jobInput.length() - 1);
    drawJobPrompt();
  } else if (key == 'C') {
    JsonDocument doc;
    callApi("POST", "/api/v1/logout", "{\"session\":\"" + sessionId + "\"}", doc);
    goIdle();
  } else if (key == '#') {
    submitJob();
  } else if (key == 'A') {
    submitStatus("REWORK", "REWORK");
  } else if (key == 'B') {
    submitStatus("ON_HOLD", "ON HOLD");
  } else if (key == 'D') {
    submitStatus("WAIT_PARTS", "WAITING PARTS");
  }
}

// ======================= SETUP / LOOP ==================
void connectWifi() {
  if (!WIFI_SSID[0] || !WIFI_PASS[0]) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  lastWifiTry = millis();
}

void setup() {
  Serial.begin(115200);
  delay(300);
  if (!WIFI_SSID[0] || !WIFI_PASS[0] || !SERVER_URL[0] || !DEVICE_TOKEN[0]) {
    Serial.println("ERROR,configure Wi-Fi, server URL, and device token before use");
  }

  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_AMBER, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  allLedsOff();
  keypad.setDebounceTime(30);

  Wire.begin(LCD_SDA, LCD_SCL);
  int status = lcd.begin(16, 2);
  if (status) Serial.println("ERROR,LCD not found - check SDA/SCL and power");
  lcdPrint(0, "RFID TERMINAL");
  lcdPrint(1, "Starting...");

  const uint8_t leds[3] = {LED_GREEN, LED_AMBER, LED_RED};     // LED self-test
  for (uint8_t i = 0; i < 3; i++) { digitalWrite(leds[i], HIGH); delay(200); digitalWrite(leds[i], LOW); }

  SPI.begin(RC522_SCK, RC522_MISO, RC522_MOSI, RC522_SS);
  rfid.PCD_Init();
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.printf("INFO,RC522 version register = 0x%02X\n", v);
  if (v == 0x00 || v == 0xFF) {
    lcdPrint(0, "RFID NOT FOUND");
    lcdPrint(1, "Check wiring");
    delay(3000);
  }

  lcdPrint(0, "Connecting WiFi");
  connectWifi();
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 12000) delay(250);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("INFO,WiFi connected, IP " + WiFi.localIP().toString());
    lcdPrint(1, WiFi.localIP().toString());
    delay(1200);
  } else {
    Serial.println("WARN,WiFi not connected yet, will keep trying");
  }
  refreshConfig();
  lastConfig = millis();
  goIdle();
}

void loop() {
  char key = keypad.getKey();

  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiTry > WIFI_RETRY_MS) {
    WiFi.disconnect();
    connectWifi();
  }

  switch (state) {
    case S_IDLE:     handleIdle(key);    break;
    case S_WAIT_JOB: handleWaitJob(key); break;
    case S_RESULT:
      if (millis() - stateStart > RESULT_MS) goIdle();
      break;
  }
}
