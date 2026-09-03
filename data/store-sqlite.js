// SQLite-backed store compatible with data/store.js API
import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { normalizeScaling } from "../lib/scaling.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "store.sqlite");
const JSON_FILES = {
  runs: path.join(__dirname, "runs.json"),
  audit: path.join(__dirname, "audit.json"),
  costLedger: path.join(__dirname, "costLedger.json"),
  settings: path.join(__dirname, "settings.json"),
};

function newId() {
  return crypto.randomUUID();
}

function ensureDb() {
  const init = !fs.existsSync(DB_PATH);
  const db = new Database(DB_PATH);
  if (init) {
    db.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE audit (
        id TEXT PRIMARY KEY,
        ts TEXT,
        actingRole TEXT,
        action TEXT,
        runId TEXT,
        details TEXT
      );
      CREATE TABLE cost (
        id TEXT PRIMARY KEY,
        ts TEXT,
        runId TEXT,
        revision INTEGER,
        phase TEXT,
        agent TEXT,
        provider TEXT,
        model TEXT,
        promptTokens INTEGER,
        completionTokens INTEGER,
        totalTokens INTEGER,
        costUsd REAL
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }
  return db;
}

function readJsonIfExists(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

// migrate existing JSON files into sqlite (best-effort)
function migrateIfNeeded(db) {
  // runs
  const runs = readJsonIfExists(JSON_FILES.runs, []);
  const insertRun = db.prepare("INSERT OR REPLACE INTO runs (id,payload) VALUES (?,?)");
  const insertAudit = db.prepare("INSERT OR REPLACE INTO audit (id,ts,actingRole,action,runId,details) VALUES (?,?,?,?,?,?)");
  const insertCost = db.prepare(`INSERT OR REPLACE INTO cost (id,ts,runId,revision,phase,agent,provider,model,promptTokens,completionTokens,totalTokens,costUsd) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertSetting = db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)");
  for (const r of runs) {
    insertRun.run(r.id, JSON.stringify(r));
  }
  const audits = readJsonIfExists(JSON_FILES.audit, []);
  for (const a of audits) {
    insertAudit.run(a.id, a.ts, a.actingRole, a.action, a.runId || null, a.details ? JSON.stringify(a.details) : null);
  }
  const costs = readJsonIfExists(JSON_FILES.costLedger, []);
  for (const c of costs) {
    insertCost.run(c.id, c.ts, c.runId, c.revision || null, c.phase || null, c.agent || null, c.provider || null, c.model || null, c.promptTokens || 0, c.completionTokens || 0, c.totalTokens || 0, c.costUsd || 0);
  }
  const settings = readJsonIfExists(JSON_FILES.settings, {});
  for (const k of Object.keys(settings)) {
    insertSetting.run(k, JSON.stringify(settings[k]));
  }
}

const db = ensureDb();
migrateIfNeeded(db);

// helper to load run object
function loadRunRow(row) {
  if (!row) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

export { newId };

// Runs
export function listRuns() {
  const rows = db.prepare("SELECT payload FROM runs ORDER BY rowid").all();
  return rows.map(r => loadRunRow(r)).filter(Boolean);
}

export function getRun(id) {
  const row = db.prepare("SELECT payload FROM runs WHERE id = ?").get(id);
  return loadRunRow(row);
}

export function insertRun(run) {
  const stmt = db.prepare("INSERT OR REPLACE INTO runs (id,payload) VALUES (?,?)");
  stmt.run(run.id, JSON.stringify(run));
  return run;
}

export function updateRun(id, updater) {
  const cur = getRun(id);
  if (!cur) return null;
  const updated = updater(cur);
  const stmt = db.prepare("INSERT OR REPLACE INTO runs (id,payload) VALUES (?,?)");
  stmt.run(id, JSON.stringify(updated));
  return updated;
}

// Audit
export function listAudit() {
  const rows = db.prepare("SELECT id,ts,actingRole,action,runId,details FROM audit ORDER BY ts").all();
  return rows.map(r => ({ id: r.id, ts: r.ts, actingRole: r.actingRole, action: r.action, runId: r.runId, details: r.details ? JSON.parse(r.details) : null }));
}

export function appendAudit({ actingRole, action, runId, details }) {
  const entry = { id: newId(), ts: new Date().toISOString(), actingRole, action, runId: runId || null, details: details || null };
  const stmt = db.prepare("INSERT INTO audit (id,ts,actingRole,action,runId,details) VALUES (?,?,?,?,?,?)");
  stmt.run(entry.id, entry.ts, entry.actingRole, entry.action, entry.runId, entry.details ? JSON.stringify(entry.details) : null);
  return entry;
}

// Cost ledger
export function listCost() {
  const rows = db.prepare("SELECT * FROM cost ORDER BY ts").all();
  return rows.map(r => ({ id: r.id, ts: r.ts, runId: r.runId, revision: r.revision, phase: r.phase, agent: r.agent, provider: r.provider, model: r.model, promptTokens: r.promptTokens, completionTokens: r.completionTokens, totalTokens: r.totalTokens, costUsd: r.costUsd }));
}

export function appendCost({ runId, revision, phase, agent, provider, model, usage, costUsd }) {
  const entry = { id: newId(), ts: new Date().toISOString(), runId, revision, phase, agent, provider, model, promptTokens: usage?.promptTokens ?? 0, completionTokens: usage?.completionTokens ?? 0, totalTokens: usage?.totalTokens ?? 0, costUsd: costUsd || 0 };
  const stmt = db.prepare("INSERT INTO cost (id,ts,runId,revision,phase,agent,provider,model,promptTokens,completionTokens,totalTokens,costUsd) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  stmt.run(entry.id, entry.ts, entry.runId, entry.revision, entry.phase, entry.agent, entry.provider, entry.model, entry.promptTokens, entry.completionTokens, entry.totalTokens, entry.costUsd);
  return entry;
}

// Settings. Always returns a normalized shape: provider/model defaults plus
// the `scaling` flags (see lib/scaling.js). saveSettings shallow-merges its
// argument onto the stored object so a partial write (e.g. only `scaling`)
// never drops the rest.
export function getSettings() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'settings'").get();
  let raw = {};
  if (row) {
    try { raw = JSON.parse(row.value); } catch { raw = {}; }
  }
  return {
    defaultProvider: raw.defaultProvider ?? null,
    defaultModel: raw.defaultModel ?? null,
    scaling: normalizeScaling(raw.scaling),
  };
}

export function saveSettings(patch) {
  const current = getSettings();
  const merged = { ...current, ...(patch || {}) };
  if (patch && patch.scaling) {
    merged.scaling = normalizeScaling({ ...current.scaling, ...patch.scaling });
  }
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('settings',?)");
  stmt.run(JSON.stringify(merged));
  return merged;
}
