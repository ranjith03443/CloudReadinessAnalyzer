// Lightweight JSON-file-backed persistence — a prototype stand-in for a real
// database (SQLite/Postgres in Pilot). Synchronous read-modify-write keeps
// each operation atomic within Node's single-threaded event loop, which is
// enough for a single-process demo; it is not built for concurrent writers.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FILES = {
  runs: path.join(__dirname, "runs.json"),
  audit: path.join(__dirname, "audit.json"),
  costLedger: path.join(__dirname, "costLedger.json"),
  settings: path.join(__dirname, "settings.json"),
};

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function newId() {
  return crypto.randomUUID();
}

// --- Runs -----------------------------------------------------------------

export function listRuns() {
  return readJson(FILES.runs, []);
}

export function getRun(id) {
  return listRuns().find((r) => r.id === id) || null;
}

export function insertRun(run) {
  const runs = listRuns();
  runs.push(run);
  writeJson(FILES.runs, runs);
  return run;
}

// `updater` receives the current run and returns the new run object.
export function updateRun(id, updater) {
  const runs = listRuns();
  const idx = runs.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  runs[idx] = updater(runs[idx]);
  writeJson(FILES.runs, runs);
  return runs[idx];
}

// --- Audit log --------------------------------------------------------------

export function listAudit() {
  return readJson(FILES.audit, []);
}

export function appendAudit({ actingRole, action, runId, details }) {
  const audit = listAudit();
  const entry = {
    id: newId(),
    ts: new Date().toISOString(),
    actingRole,
    action,
    runId: runId || null,
    details: details || null,
  };
  audit.push(entry);
  writeJson(FILES.audit, audit);
  return entry;
}

// --- Cost ledger ------------------------------------------------------------

export function listCost() {
  return readJson(FILES.costLedger, []);
}

export function appendCost({ runId, revision, phase, agent, provider, model, usage, costUsd }) {
  const ledger = listCost();
  const entry = {
    id: newId(),
    ts: new Date().toISOString(),
    runId,
    revision,
    phase,
    agent,
    provider,
    model,
    promptTokens: usage?.promptTokens ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    costUsd: costUsd || 0,
  };
  ledger.push(entry);
  writeJson(FILES.costLedger, ledger);
  return entry;
}

// --- Settings ---------------------------------------------------------------

export function getSettings() {
  return readJson(FILES.settings, { defaultProvider: null, defaultModel: null });
}

export function saveSettings(settings) {
  writeJson(FILES.settings, settings);
  return settings;
}
