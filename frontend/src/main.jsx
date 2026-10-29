import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, json } from "./api";
import "./styles.css";

const STAGES = ["FABRICATION", "TECHNICAL", "DELIVERY"];
const NAV_ITEMS = [
  { label: "Line board", icon: "board" },
  { label: "Jobs", icon: "jobs" },
  { label: "Inventory", icon: "inventory" },
  { label: "Employees", icon: "employees" },
  { label: "Terminals", icon: "terminals" },
  { label: "Activity", icon: "activity" },
  { label: "Account", icon: "account" },
];
const stageLabel = (stage) =>
  ({
    FABRICATION: "Fabrication",
    TECHNICAL: "Technical / Refrigeration",
    DELIVERY: "Polishing",
  })[stage] || stage;
const when = (value) =>
  value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not yet";
const duration = (start, end = Date.now()) => {
  const seconds = Math.max(
    0,
    Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000),
  );
  if (!Number.isFinite(seconds)) return "Unknown";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
};

function Icon({ name }) {
  const drawings = {
    board: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    jobs: (
      <>
        <path d="m3 7 9-4 9 4-9 4-9-4Z" />
        <path d="M3 7v10l9 4 9-4V7M12 11v10" />
      </>
    ),
    inventory: (
      <>
        <path d="M4 4h16v16H4z" />
        <path d="M4 9h16M9 13h6" />
      </>
    ),
    employees: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5.2a3 3 0 0 1 0 5.6M18 14a5 5 0 0 1 3 4.6V20" />
      </>
    ),
    terminals: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
    activity: (
      <>
        <path d="M3 12h4l3-8 4 16 3-8h4" />
      </>
    ),
    account: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
  };
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {drawings[name]}
    </svg>
  );
}

function Modal({ children, onClose }) {
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Process tracker dialog"
      >
        <button
          className="modal-close"
          onClick={onClose}
          aria-label="Close dialog"
        >
          ×
        </button>
        {children}
      </section>
    </div>
  );
}
function Pill({ job }) {
  return (
    <span className={`pill tone-${job.tone}`}>
      <i aria-hidden="true"></i>
      {job.label}
    </span>
  );
}
const eventTone = (event) =>
  /INVALID|WRONG_STAGE|REJECT|CANCEL/i.test(event)
    ? "bad"
    : /HOLD|REWORK|WAIT|INACTIVE/i.test(event)
      ? "warn"
      : "ok";

function Login({ onLogin }) {
  const [username, setUsername] = useState("manager");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      onLogin(
        (await api("/api/login", json("POST", { username, password })))
          .username,
      );
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <img
          className="login-logo"
          src="/allied-metals-logo-primary-transparent.png"
          alt="Allied Metals, Inc."
        />
        <p className="eyebrow">MANUFACTURING OPERATIONS</p>
        <h1>Process Tracker</h1>
        <p className="muted">
          Sign in to view production and manage terminal access.
        </p>
        <label>
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <p className="error" role="alert">
          {error}
        </p>
        <button disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <p className="login-company">Allied Metals, Inc.</p>
      </form>
    </main>
  );
}

function JobForm({ close, refresh, toast }) {
  const [equipment_type, setType] = useState("");
  const [needs_tech, setNeedsTech] = useState(false);
  const [notes, setNotes] = useState("");
  const [design_url, setDesign] = useState("");
  const [cad, setCad] = useState(null);
  const [error, setError] = useState("");

  return (
    <Modal onClose={close}>
      <h2>New job</h2>
      <p className="muted">It starts in the Fabrication queue.</p>
      <form
        className="dialog-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const body = new FormData();
          body.append("equipment_type", equipment_type);
          body.append("needs_tech", String(needs_tech));
          body.append("notes", notes);
          body.append("design_url", design_url);
          if (cad) body.append("cad", cad);
          try {
            await api("/api/jobs", { method: "POST", body });
            toast("Job created");
            refresh();
            close();
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        <label>
          Equipment type
          <input
            value={equipment_type}
            onChange={(event) => setType(event.target.value)}
            maxLength="80"
            required
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={needs_tech}
            onChange={(event) => setNeedsTech(event.target.checked)}
          />
          <span>Needs Technical / Refrigeration</span>
        </label>
        <label>
          Design file (optional)
          <input
            type="file"
            accept=".pdf,.dwg,.dxf,.step,.stp,.png,.jpg,.jpeg"
            onChange={(event) => {
              const selected = event.target.files?.[0] || null;
              if (selected && selected.size > 25 * 1024 * 1024) {
                event.target.value = "";
                setCad(null);
                setError("Design file must be 25 MB or smaller.");
                return;
              }
              setCad(selected);
              setError("");
            }}
          />
          <small>PDF, DWG, DXF, STEP, or image files up to 25 MB.</small>
        </label>
        <label>
          Design URL (optional)
          <input
            type="url"
            value={design_url}
            onChange={(event) => setDesign(event.target.value)}
            placeholder="https://..."
          />
        </label>
        <label>
          Notes (optional)
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength="500"
          />
        </label>
        <p className="error">{error}</p>
        <div className="dialog-actions">
          <button className="secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button>Create job</button>
        </div>
      </form>
    </Modal>
  );
}

function JobDialog({ id, close, refresh, toast }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    api(`/api/jobs/${id}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      });
    return () => {
      active = false;
    };
  }, [id, reload]);
  if (!data)
    return (
      <Modal onClose={close}>
        <p>{error || "Loading job…"}</p>
        {error && (
          <button
            className="secondary"
            onClick={() => {
              setError("");
              setReload((value) => value + 1);
            }}
          >
            Retry
          </button>
        )}
      </Modal>
    );
  const job = data.job;
  const open = ["QUEUED", "IN_PROGRESS"].includes(job.state);
  const action = async (name) => {
    if (
      (name === "cancel" || name === "release") &&
      !confirm(`${name === "cancel" ? "Cancel" : "Release"} job ${job.job_no}?`)
    )
      return;
    try {
      await api(
        `/api/jobs/${job.job_no}/action`,
        json("POST", { action: name }),
      );
      toast(`Job ${job.job_no} updated`);
      refresh();
      close();
    } catch (actionError) {
      setError(actionError.message);
    }
  };
  return (
    <Modal onClose={close}>
      <h2>Job {job.job_no}</h2>
      <p className="muted">{job.equipment_type}</p>
      <dl className="facts">
        <dt>Status</dt>
        <dd>
          <Pill job={job} />
        </dd>
        <dt>Stage</dt>
        <dd>{job.stage_label}</dd>
        <dt>Stage duration</dt>
        <dd>{duration(job.stage_since)}</dd>
        <dt>Created</dt>
        <dd>{when(job.created_at)}</dd>
        {job.finished_at && (
          <>
            <dt>Finished</dt>
            <dd>{when(job.finished_at)}</dd>
          </>
        )}
        <dt>Design</dt>
        <dd>
          {job.has_cad ? (
            <a href={`/api/jobs/${job.job_no}/cad`}>
              Download {data.cad_name || "design file"}
            </a>
          ) : (
            "No design attached"
          )}
        </dd>
        <dt>Notes</dt>
        <dd>{job.notes || "No notes"}</dd>
      </dl>
      {open && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={!!job.needs_tech}
              disabled={job.stage !== "FABRICATION"}
              onChange={async (event) => {
                try {
                  await api(
                    `/api/jobs/${job.job_no}`,
                    json("PATCH", { needs_tech: event.target.checked }),
                  );
                  toast("Routing updated");
                  const result = await api(`/api/jobs/${id}`);
                  setData(result);
                  refresh();
                } catch (updateError) {
                  setError(updateError.message);
                }
              }}
            />
            <span>Needs Technical / Refrigeration</span>
          </label>
          <div className="dialog-actions">
            <button
              className="secondary"
              onClick={() => action(job.held ? "resume" : "hold")}
            >
              {job.held ? "Remove hold" : "Hold job"}
            </button>
            <button onClick={() => action("release")}>
              Release next stage
            </button>
            <button className="danger" onClick={() => action("cancel")}>
              Cancel job
            </button>
          </div>
        </>
      )}
      <h3>History</h3>
      {data.events.length ? (
        <ol className="history">
          {data.events.map((event) => (
            <li key={event.id}>
              <time>{when(event.ts)}</time>
              <span>
                <b>{event.event}</b> {event.detail}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No activity recorded yet.</p>
      )}
      <p className="error" role="alert">
        {error}
      </p>
    </Modal>
  );
}

function EmployeeDialog({ employee, close, refresh, toast }) {
  const [name, setName] = useState(employee?.name || "");
  const [rfid_uid, setUid] = useState(employee?.rfid_uid || "");
  const [stage, setStage] = useState(employee?.stage || "FABRICATION");
  const [cards, setCards] = useState([]);
  const [error, setError] = useState("");
  const [cardsError, setCardsError] = useState("");
  useEffect(() => {
    let active = true;
    api("/api/unregistered-cards")
      .then((result) => {
        if (active) setCards(result.cards);
      })
      .catch((requestError) => {
        if (active) setCardsError(requestError.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const submit = async (event) => {
    event.preventDefault();
    try {
      await api(
        employee ? `/api/employees/${employee.id}` : "/api/employees",
        json(employee ? "PATCH" : "POST", { name, rfid_uid, stage }),
      );
      toast(employee ? "Employee updated" : "Employee added");
      refresh();
      close();
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  return (
    <Modal onClose={close}>
      <h2>{employee ? "Edit employee" : "Add employee"}</h2>
      <form className="dialog-form" onSubmit={submit}>
        <label>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength="60"
            required
          />
        </label>
        <label>
          Stage
          <select
            value={stage}
            onChange={(event) => setStage(event.target.value)}
          >
            {STAGES.map((value) => (
              <option value={value} key={value}>
                {stageLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Card UID
          <input
            value={rfid_uid}
            onChange={(event) => setUid(event.target.value)}
            placeholder="01:02:03:04"
            required
          />
          <small>
            Enter a 4, 7, or 10 byte UID; colons or hyphens are optional.
          </small>
        </label>
        {cardsError && (
          <p className="error" role="status">
            Observed cards could not be loaded: {cardsError}
          </p>
        )}
        {cards.length > 0 && (
          <div>
            <small>Observed unregistered cards</small>
            <div className="chips">
              {cards.map((card) => (
                <button
                  type="button"
                  className="chip"
                  onClick={() => setUid(card.uid)}
                  key={card.uid}
                >
                  {card.uid}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="error" role="alert">
          {error}
        </p>
        <div className="dialog-actions">
          <button className="secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button>{employee ? "Save changes" : "Add employee"}</button>
        </div>
      </form>
    </Modal>
  );
}

function TokenReveal({ token, onClose }) {
  const [message, setMessage] = useState(
    "Save this token now. It cannot be retrieved later.",
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setMessage("Token copied. Store it somewhere safe.");
    } catch {
      setMessage(
        "Copy is unavailable here. Select and copy the token manually.",
      );
    }
  };
  return (
    <Modal onClose={onClose}>
      <h2>Device token</h2>
      <p className="muted">{message}</p>
      <label>
        Shown once
        <input
          value={token}
          readOnly
          onFocus={(event) => event.target.select()}
        />
      </label>
      <div className="dialog-actions">
        <button className="secondary" onClick={copy}>
          Copy token
        </button>
        <button onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

function TerminalDialog({ close, refresh, toast }) {
  const [name, setName] = useState("");
  const [stage, setStage] = useState("FABRICATION");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  if (token) return <TokenReveal token={token} onClose={close} />;
  return (
    <Modal onClose={close}>
      <h2>Add terminal</h2>
      <form
        className="dialog-form"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            const result = await api(
              "/api/terminals",
              json("POST", { name, stage }),
            );
            setToken(result.token);
            toast("Terminal added");
            refresh();
          } catch (requestError) {
            setError(requestError.message);
          }
        }}
      >
        <label>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength="40"
            required
          />
        </label>
        <label>
          Initial stage
          <select
            value={stage}
            onChange={(event) => setStage(event.target.value)}
          >
            {STAGES.map((value) => (
              <option value={value} key={value}>
                {stageLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <p className="error" role="alert">
          {error}
        </p>
        <div className="dialog-actions">
          <button className="secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button>Add terminal</button>
        </div>
      </form>
    </Modal>
  );
}

function Simulator() {
  const [token, setToken] = useState(() => {
    try {
      return window.localStorage.getItem("simToken") || "";
    } catch {
      return "";
    }
  });
  const [session, setSession] = useState("");
  const [job, setJob] = useState("");
  const [status, setStatus] = useState("IN_PROGRESS");
  const [uid, setUid] = useState("");
  const [lcd, setLcd] = useState("Not connected");
  const [log, setLog] = useState([]);
  const [connected, setConnected] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");

  const call = async (method, path, body) => {
    try {
      const response = await fetch(path, {
        method,
        headers: {
          "X-Device-Token": token,
          ...(body && { "Content-Type": "application/json" }),
        },
        body: body && JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      setLog((items) => [
        `${new Date().toLocaleTimeString()} ${method} ${path} → ${response.status} ${JSON.stringify(data)}`,
        ...items,
      ]);
      return data;
    } catch (error) {
      const data = {
        ok: false,
        reason: "NETWORK_ERROR",
        message: error.message,
      };
      setLog((items) => [
        `${new Date().toLocaleTimeString()} ${method} ${path} → NETWORK_ERROR ${error.message}`,
        ...items,
      ]);
      setLcd(`NETWORK ERROR\n${error.message}`);
      return data;
    }
  };
  const tap = async (card) => {
    const data = await call("POST", "/api/v1/tap", { uid: card });
    if (data.ok) {
      setSession(data.session);
      setLcd(`AUTHORIZED\n${data.employee.name}\n${data.stage_label}`);
    } else {
      setSession("");
      setLcd(`REJECTED:\n${data.message || data.reason || "Request failed"}`);
    }
  };
  const work = async (action, extra = {}) => {
    if (!session) {
      setLcd("Tap your card first");
      return;
    }
    const data = await call("POST", `/api/v1/job/${action}`, {
      session,
      job,
      ...extra,
    });
    if (data.reason === "SESSION_EXPIRED") setSession("");
    setLcd(
      `${data.ok ? "OK" : "REJECTED:"}\n${data.message || data.reason || "Request failed"}`,
    );
  };
  const connect = async () => {
    try {
      window.localStorage.setItem("simToken", token);
      setStorageWarning("");
    } catch (error) {
      setStorageWarning(
        `Token was not saved in this browser: ${error.message}`,
      );
    }
    const data = await call("GET", "/api/v1/terminal/config");
    setConnected(!!data.ok);
    setSession("");
    setLcd(
      data.ok
        ? `${data.terminal.name}\nStage: ${data.terminal.stage_label}\nTap RFID card`
        : data.message || data.reason || "Connection failed",
    );
  };
  const showQueue = async () => {
    if (!session) {
      setLcd("Tap your card first");
      return;
    }
    const data = await call(
      "GET",
      `/api/v1/queue?session=${encodeURIComponent(session)}`,
    );
    if (data.reason === "SESSION_EXPIRED") setSession("");
    setLcd(
      data.ok
        ? `Queue (${data.jobs.length})\n${data.jobs.map((item) => `${item.job_no} ${item.equipment_type}: ${item.label}`).join("\n")}`
        : data.message || data.reason || "Request failed",
    );
  };
  const logout = async () => {
    if (session) {
      const result = await call("POST", "/api/v1/logout", { session });
      if (!result.ok) {
        setLcd(result.message || "Sign out request failed");
        return;
      }
    }
    setSession("");
    setLcd("Signed out\nTap RFID card");
  };
  return (
    <main className="sim">
      <header>
        <div>
          <h1>Virtual terminal</h1>
          <p className="muted">Uses the same device API as the ESP32.</p>
        </div>
        <a href="/">Manager console</a>
      </header>
      <section className="panel">
        <h2>1. Connect</h2>
        <label>
          Device token
          <input
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
              setConnected(false);
              setSession("");
            }}
            placeholder="tk_..."
            autoComplete="off"
          />
        </label>
        <button onClick={connect}>Connect</button>
        <p className="muted" role="status">
          {connected
            ? "Connected; server controls the terminal stage."
            : "Not connected."}
        </p>
        {storageWarning && <p className="muted">{storageWarning}</p>}
      </section>
      <section className="panel">
        <h2>2. Tap a card</h2>
        {[
          ["Juan", "01:02:03:04"],
          ["Maria", "11:22:33:44"],
          ["Pedro", "55:66:77:88"],
          ["Unknown", "AA:BB:CC:DD"],
        ].map(([name, card]) => (
          <button className="secondary" key={card} onClick={() => tap(card)}>
            {name}
          </button>
        ))}
        <label>
          Custom UID
          <input
            value={uid}
            onChange={(event) => setUid(event.target.value)}
            placeholder="01:02:03:04"
          />
        </label>
        <button className="secondary" onClick={() => tap(uid)}>
          Tap
        </button>
      </section>
      <section className="panel">
        <h2>3. Work on a job</h2>
        <label>
          Job number
          <input
            value={job}
            onChange={(event) => setJob(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <button onClick={() => work("start")}>Start</button>
        <button onClick={() => work("complete")}>Complete</button>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="IN_PROGRESS">In progress</option>
            <option value="ON_HOLD">On hold</option>
            <option value="REWORK">Rework</option>
            <option value="WAIT_PARTS">Waiting for parts</option>
          </select>
        </label>
        <button
          className="secondary"
          onClick={() => work("status", { status })}
        >
          Send status
        </button>
        <button className="secondary" onClick={showQueue}>
          Show queue
        </button>
        <button className="secondary" onClick={logout}>
          Sign out
        </button>
      </section>
      <section className="panel">
        <h2>Terminal display</h2>
        <pre className="lcd" aria-live="polite">
          {lcd}
        </pre>
      </section>
      <section className="panel">
        <h2>Requests</h2>
        <div className="log" aria-live="polite">
          {log.length ? (
            log.map((item, index) => <div key={`${index}-${item}`}>{item}</div>)
          ) : (
            <p className="muted">No requests yet.</p>
          )}
        </div>
      </section>
    </main>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState("Line board");
  const [overview, setOverview] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [terminals, setTerminals] = useState([]);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  const [appError, setAppError] = useState("");

  const refresh = async () => {
    try {
      const [board, employeeList, terminalList] = await Promise.all([
        api("/api/overview"),
        api("/api/employees"),
        api("/api/terminals"),
      ]);
      setOverview(board);
      setEmployees(employeeList.employees);
      setTerminals(
        terminalList.terminals.map(
          (terminal) =>
            board.terminals.find((item) => item.id === terminal.id) || terminal,
        ),
      );
      setAppError("");
    } catch (error) {
      if (/Sign in/.test(error.message)) {
        setUser(null);
        setOverview(null);
      } else {
        setAppError(error.message);
      }
    }
  };
  const refreshBoard = async () => {
    try {
      setOverview(await api("/api/overview"));
      setAppError("");
    } catch (error) {
      if (/Sign in/.test(error.message)) {
        setUser(null);
        setOverview(null);
      } else {
        setAppError(error.message);
      }
    }
  };
  const notify = (message) => {
    setToast(message);
    setTimeout(() => setToast(""), 3000);
  };

  useEffect(() => {
    let active = true;
    api("/api/me")
      .then((result) => {
        if (active) setUser(result.username);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return undefined;
    refresh();
    const timer = setInterval(refreshBoard, 5000);
    return () => clearInterval(timer);
  }, [user]);

  if (location.pathname === "/sim") return <Simulator />;
  if (authLoading)
    return (
      <main className="login">
        <p>Checking manager session…</p>
      </main>
    );
  if (!user) return <Login onLogin={setUser} />;
  if (!overview)
    return (
      <main className="work">
        {appError ? (
          <div className="page-error">
            <p className="error" role="alert">
              {appError}
            </p>
            <button onClick={refresh}>Retry</button>
          </div>
        ) : (
          <p className="loading-state" role="status">
            Loading production line…
          </p>
        )}
      </main>
    );

  let body;
  if (view === "Line board") {
    const activeCount = overview.jobs.filter(
      (job) => job.state === "IN_PROGRESS",
    ).length;
    const waitingCount = overview.jobs.filter(
      (job) => job.state === "QUEUED",
    ).length;
    const attentionJobs = overview.jobs.filter(
      (job) => job.held || job.tone === "warn" || job.tone === "bad",
    );
    body = (
      <>
        <header className="page-head">
          <div>
            <p className="eyebrow">PRODUCTION OVERVIEW</p>
            <h1>Line board</h1>
            <p className="summary">
              Live production status · refreshed every five seconds
            </p>
          </div>
          <button onClick={() => setModal({ type: "job-create" })}>
            New job
          </button>
        </header>
        <section className="board-summary" aria-label="Current job counts">
          <div>
            <span>On the floor</span>
            <strong>{overview.jobs.length}</strong>
          </div>
          <div>
            <span>Waiting to start</span>
            <strong>{waitingCount}</strong>
          </div>
          <div>
            <span>In progress</span>
            <strong>{activeCount}</strong>
          </div>
        </section>
        {attentionJobs.length > 0 && (
          <section
            className="attention-panel"
            aria-labelledby="attention-title"
          >
            <div className="attention-heading">
              <span className="attention-mark" aria-hidden="true">
                !
              </span>
              <div>
                <h2 id="attention-title">Needs attention</h2>
                <p>
                  {attentionJobs.length}{" "}
                  {attentionJobs.length === 1 ? "job" : "jobs"} has a hold or
                  exception status.
                </p>
              </div>
            </div>
            <ul>
              {attentionJobs.map((job) => (
                <li key={job.job_no}>
                  <button
                    className="attention-link"
                    onClick={() => setModal({ type: "job", id: job.job_no })}
                  >
                    Job {job.job_no} · {job.equipment_type}
                  </button>
                  <Pill job={job} />
                  <span>{job.stage_label}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="line" aria-label="Production stages">
          {overview.stages.map((stage, index) => {
            const stageJobs = overview.jobs.filter(
              (job) => job.stage === stage.key,
            );
            const stageTerminals = overview.terminals.filter(
              (terminal) => terminal.stage === stage.key,
            );
            return (
              <article className="station" key={stage.key}>
                <header className="station-head">
                  <div className="station-title">
                    <span className="stage-index">0{index + 1}</span>
                    <h2>{stage.label}</h2>
                    <span className="stage-count">
                      {stageJobs.length}{" "}
                      {stageJobs.length === 1 ? "job" : "jobs"}
                    </span>
                  </div>
                  <ul
                    className="station-terminals"
                    aria-label={`${stage.label} terminals`}
                  >
                    {stageTerminals.length ? (
                      stageTerminals.map((terminal) => (
                        <li
                          className={terminal.online ? "online" : "offline"}
                          key={terminal.id}
                        >
                          <i className="status-dot" aria-hidden="true"></i>
                          <strong>{terminal.name}</strong>
                          <span>{terminal.online ? "Online" : "Offline"}</span>
                          {terminal.operator && (
                            <small>{terminal.operator}</small>
                          )}
                        </li>
                      ))
                    ) : (
                      <li className="no-terminal">No terminal assigned</li>
                    )}
                  </ul>
                </header>
                <div className="bench">
                  {stageJobs.length ? (
                    stageJobs.map((job) => (
                      <button
                        className={`tag tone-${job.tone}${job.held ? " held" : ""}`}
                        key={job.job_no}
                        onClick={() =>
                          setModal({ type: "job", id: job.job_no })
                        }
                        aria-label={`Open job ${job.job_no}, ${job.equipment_type}, ${job.label}`}
                      >
                        <b>{job.job_no}</b>
                        <span>
                          <strong>{job.equipment_type}</strong>
                          <Pill job={job} />
                          <small>
                            At this stage since {when(job.stage_since)}
                          </small>
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="empty">Nothing here yet.</p>
                  )}
                </div>
              </article>
            );
          })}
        </section>
        <section className="recent">
          <div className="section-heading">
            <div>
              <p className="eyebrow">TRACEABILITY</p>
              <h2>Latest activity</h2>
            </div>
            <span>
              {overview.events.length} recent{" "}
              {overview.events.length === 1 ? "event" : "events"}
            </span>
          </div>
          {overview.events.length ? (
            <ul className="activity-feed">
              {overview.events.map((event) => (
                <li key={event.id}>
                  <time dateTime={event.ts}>{when(event.ts)}</time>
                  <span className="event-name">{event.event}</span>
                  <span>
                    {event.detail ||
                      event.employee_name ||
                      event.terminal_name ||
                      "Activity recorded"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No production activity yet.</p>
          )}
        </section>
        {appError && (
          <p className="error inline-error" role="status">
            {appError}
          </p>
        )}
      </>
    );
  } else if (view === "Jobs" || view === "Inventory") {
    body = (
      <JobsPage
        inventory={view === "Inventory"}
        jobs={overview.jobs}
        open={(id) => setModal({ type: "job", id })}
        create={() => setModal({ type: "job-create" })}
      />
    );
  } else if (view === "Employees") {
    body = (
      <EmployeesPage
        employees={employees}
        edit={(employee) => setModal({ type: "employee", employee })}
        add={() => setModal({ type: "employee" })}
        refresh={refresh}
        notify={notify}
      />
    );
  } else if (view === "Terminals") {
    body = (
      <TerminalsPage
        terminals={terminals}
        add={() => setModal({ type: "terminal" })}
        refresh={refresh}
        notify={notify}
      />
    );
  } else if (view === "Activity") {
    body = <ActivityPage />;
  } else {
    body = <AccountPage user={user} notify={notify} />;
  }

  const signOut = async () => {
    try {
      await api("/api/logout", json("POST", {}));
      setUser(null);
      setOverview(null);
    } catch (error) {
      notify(error.message);
    }
  };
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <img
            src="/allied-metals-logo-primary-transparent.png"
            alt="Allied Metals, Inc."
          />
          <span className="brand-divider"></span>
          <span className="brand-product">
            Process Tracker<small>Manufacturing operations</small>
          </span>
        </div>
        <nav aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.label}
              className={view === item.label ? "selected" : ""}
              aria-current={view === item.label ? "page" : undefined}
              onClick={() => setView(item.label)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <a className="sim-link" href="/sim">
          <Icon name="terminals" />
          Virtual terminal
        </a>
        <div className="manager-profile">
          <span className="manager-avatar" aria-hidden="true">
            {user.slice(0, 2).toUpperCase()}
          </span>
          <span className="manager-details">
            <strong>{user}</strong>
            <small>Manager</small>
          </span>
          <button className="profile-signout" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="work">{body}</main>
      {modal?.type === "job-create" && (
        <JobForm
          close={() => setModal(null)}
          refresh={refresh}
          toast={notify}
        />
      )}
      {modal?.type === "job" && (
        <JobDialog
          id={modal.id}
          close={() => setModal(null)}
          refresh={refresh}
          toast={notify}
        />
      )}
      {modal?.type === "employee" && (
        <EmployeeDialog
          employee={modal.employee}
          close={() => setModal(null)}
          refresh={refresh}
          toast={notify}
        />
      )}
      {modal?.type === "terminal" && (
        <TerminalDialog
          close={() => setModal(null)}
          refresh={refresh}
          toast={notify}
        />
      )}
      <div
        className={toast ? "toast show" : "toast"}
        role="status"
        aria-live="polite"
      >
        {toast}
      </div>
    </div>
  );
}

function JobsPage({ inventory, jobs, open, create }) {
  const [finished, setFinished] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    setError("");
    if (!inventory) return undefined;
    let active = true;
    api("/api/jobs?scope=finished")
      .then((result) => {
        if (active) setFinished(result.jobs);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      });
    return () => {
      active = false;
    };
  }, [inventory, reload]);
  const rows = inventory ? finished : jobs;
  const statuses = [...new Set((rows || []).map((job) => job.label))].sort();
  const filtered = (rows || []).filter((job) => {
    const matchesText = `${job.job_no} ${job.equipment_type}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
    return (
      matchesText && (statusFilter === "all" || job.label === statusFilter)
    );
  });
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">
            {inventory ? "COMPLETED WORK" : "PRODUCTION QUEUE"}
          </p>
          <h1>{inventory ? "Inventory" : "Jobs"}</h1>
          <p className="summary">
            {inventory
              ? "Delivered and cancelled jobs."
              : "Active work across the manufacturing stages."}
          </p>
        </div>
        {!inventory && <button onClick={create}>New job</button>}
      </header>
      <div className="table-tools">
        <label className="filter-field">
          Filter jobs
          <input
            className="filter"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Job number or equipment"
          />
        </label>
        <label className="status-filter">
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            {statuses.map((status) => (
              <option value={status} key={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <span className="result-count" aria-live="polite">
          {rows === null
            ? "Loading"
            : `${filtered.length} ${filtered.length === 1 ? "job" : "jobs"}`}
        </span>
      </div>
      {error && (
        <div className="page-error" role="alert">
          <p>{error}</p>
          <button
            className="secondary"
            onClick={() => setReload((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table className="grid">
          <caption className="sr-only">
            {inventory ? "Finished jobs" : "Active jobs"}
          </caption>
          <thead>
            <tr>
              <th scope="col">Job</th>
              <th scope="col">Equipment</th>
              <th scope="col">Logged</th>
              <th scope="col">Stage</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr>
                <td className="table-message" colSpan="5">
                  <span className="loading-indicator" />
                  Loading jobs…
                </td>
              </tr>
            ) : error ? null : filtered.length === 0 ? (
              <tr>
                <td className="table-message" colSpan="5">
                  {query || statusFilter !== "all"
                    ? "No jobs match these filters."
                    : inventory
                      ? "No finished jobs yet."
                      : "No active jobs."}
                </td>
              </tr>
            ) : (
              filtered.map((job) => (
                <tr
                  className="selectable-row"
                  onClick={() => open(job.job_no)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      open(job.job_no);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open job ${job.job_no}, ${job.equipment_type}, ${job.label}`}
                  key={job.job_no}
                >
                  <td data-label="Job">
                    <strong className="job-number">{job.job_no}</strong>
                  </td>
                  <td data-label="Equipment">{job.equipment_type}</td>
                  <td data-label="Logged">
                    <time dateTime={job.created_at}>
                      {when(job.created_at)}
                    </time>
                  </td>
                  <td data-label="Stage">{job.stage_label}</td>
                  <td data-label="Status">
                    <Pill job={job} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
function EmployeesPage({ employees, edit, add, refresh, notify }) {
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">PEOPLE & ACCESS</p>
          <h1>Employees</h1>
          <p className="summary">
            RFID authorization and production-stage access.
          </p>
        </div>
        <button onClick={add}>Add employee</button>
      </header>
      <div className="table-wrap">
        <table className="grid">
          <caption className="sr-only">Employee access assignments</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Stage</th>
              <th scope="col">Card UID</th>
              <th scope="col">Status</th>
              <th scope="col">Last sign-in</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {employees.length ? (
              employees.map((employee) => (
                <tr key={employee.id}>
                  <td data-label="Name">
                    <strong>{employee.name}</strong>
                  </td>
                  <td data-label="Stage">
                    <span className="stage-label">{employee.stage_label}</span>
                  </td>
                  <td data-label="Card UID">
                    <code className="uid-code">{employee.rfid_uid}</code>
                  </td>
                  <td data-label="Status">
                    <span
                      className={`status-label ${employee.active ? "is-active" : "is-inactive"}`}
                    >
                      <i className="status-dot" aria-hidden="true" />
                      {employee.active ? "Active" : "Deactivated"}
                    </span>
                  </td>
                  <td data-label="Last sign-in">
                    {employee.last_login ? when(employee.last_login) : "Never"}
                  </td>
                  <td data-label="Actions" className="row-actions">
                    <button
                      className="secondary compact"
                      onClick={() => edit(employee)}
                    >
                      Edit
                    </button>
                    <button
                      className="secondary compact"
                      onClick={async () => {
                        try {
                          await api(
                            `/api/employees/${employee.id}`,
                            json("PATCH", { active: !employee.active }),
                          );
                          notify(
                            employee.active
                              ? "Employee deactivated"
                              : "Employee reactivated",
                          );
                          refresh();
                        } catch (error) {
                          notify(error.message);
                        }
                      }}
                    >
                      {employee.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="table-message" colSpan="6">
                  No employees registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
function TerminalsPage({ terminals, add, refresh, notify }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const issueToken = async (id) => {
    try {
      setToken(
        (await api(`/api/terminals/${id}/token`, json("POST", {}))).token,
      );
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  return (
    <>
      {" "}
      <header className="page-head">
        <div>
          <p className="eyebrow">DEVICE MANAGEMENT</p>
          <h1>Terminals</h1>
          <p className="summary">
            Set a terminal’s stage without reflashing its ESP32.
          </p>
        </div>
        <button onClick={add}>Add terminal</button>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {terminals.length ? (
        terminals.map((terminal) => (
          <article className="terminal" key={terminal.id}>
            <div className="terminal-identity">
              <h2>{terminal.name}</h2>
              <span
                className={`status-label ${terminal.online ? "is-active" : "is-inactive"}`}
              >
                <i className="status-dot" aria-hidden="true" />
                {terminal.online ? "Online" : "Offline"}
              </span>
              <p>
                {terminal.online
                  ? `Last seen ${when(terminal.last_seen)}`
                  : `Last connected ${when(terminal.last_seen)}`}
                {terminal.operator ? ` · ${terminal.operator} signed in` : ""}
              </p>
            </div>
            <label>
              Stage
              <select
                value={terminal.stage}
                onChange={async (event) => {
                  try {
                    await api(
                      `/api/terminals/${terminal.id}`,
                      json("PATCH", { stage: event.target.value }),
                    );
                    notify("Terminal stage changed; operator signed out.");
                    refresh();
                  } catch (requestError) {
                    setError(requestError.message);
                  }
                }}
              >
                {STAGES.map((stage) => (
                  <option value={stage} key={stage}>
                    {stageLabel(stage)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              onClick={() => issueToken(terminal.id)}
            >
              Issue new token
            </button>
          </article>
        ))
      ) : (
        <p className="empty">No terminals registered.</p>
      )}
      {token && <TokenReveal token={token} onClose={() => setToken("")} />}
    </>
  );
}
function ActivityPage() {
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await api(
          `/api/events?limit=150&q=${encodeURIComponent(query)}`,
        );
        if (active) {
          setEvents(result.events);
          setError("");
        }
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, reload]);
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">AUDIT TRAIL</p>
          <h1>Activity</h1>
          <p className="summary">
            Server-recorded terminal and manager actions.
          </p>
        </div>
      </header>
      <label className="filter-field activity-filter">
        Filter activity
        <input
          className="filter"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Job, employee, terminal, event, or detail"
        />
      </label>
      {error && (
        <div className="page-error" role="alert">
          <p>{error}</p>
          <button
            className="secondary"
            onClick={() => setReload((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table className="grid">
          <caption className="sr-only">Production activity log</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Event</th>
              <th scope="col">Who</th>
              <th scope="col">Stage</th>
              <th scope="col">Job</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="table-message" colSpan="6">
                  <span className="loading-indicator" />
                  Loading activity…
                </td>
              </tr>
            ) : events.length ? (
              events.map((event) => (
                <tr key={event.id}>
                  <td data-label="Time">
                    <time dateTime={event.ts}>{when(event.ts)}</time>
                  </td>
                  <td data-label="Event">
                    <span
                      className={`event-badge event-${eventTone(event.event)}`}
                    >
                      <i className="status-dot" aria-hidden="true" />
                      {event.event}
                    </span>
                  </td>
                  <td data-label="Who">
                    {event.employee_name || event.terminal_name || "System"}
                  </td>
                  <td data-label="Stage">
                    {event.stage ? stageLabel(event.stage) : "—"}
                  </td>
                  <td data-label="Job">{event.job_no || "—"}</td>
                  <td data-label="Detail">{event.detail || "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="table-message" colSpan="6">
                  {query
                    ? "No activity matches this filter."
                    : "No activity recorded yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
function AccountPage({ user, notify }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    try {
      await api("/api/password", json("POST", { current, new: next }));
      setCurrent("");
      setNext("");
      setSuccess("Password changed.");
      notify("Password changed");
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  return (
    <section className="account">
      <p className="eyebrow">MANAGER PROFILE</p>
      <h1>Account</h1>
      <p>
        Signed in as <b>{user}</b>.
      </p>
      <div className="account-divider"></div>
      <h2>Change password</h2>
      <p className="muted">
        Use a unique password to protect production access.
      </p>
      <form className="dialog-form" onSubmit={submit}>
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            required
          />
        </label>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            minLength="8"
            required
          />
          <small>At least 8 characters.</small>
        </label>
        <p className="error" role="alert">
          {error}
        </p>
        {success && (
          <p className="muted" role="status">
            {success}
          </p>
        )}
        <button>Change password</button>
      </form>
    </section>
  );
}

if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
createRoot(document.getElementById("root")).render(<App />);
