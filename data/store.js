// Lightweight JSON-file-backed persistence — a prototype stand-in for a real
// database (SQLite/Postgres in Pilot). Synchronous read-modify-write keeps
// each operation atomic within Node's single-threaded event loop, which is
// enough for a single-process demo; it is not built for concurrent writers.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeScaling } from "../lib/scaling.js";

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

// --- Export run outputs to data/outputs/<run-id> ---------------------------
function exportRunOutputs(run) {
  try {
    if (!run || !run.id) return;
    const outDir = path.join(__dirname, "outputs", run.id);
    fs.mkdirSync(outDir, { recursive: true });

    // modernizedCode
    const modern = run.transformation && run.transformation.modernizedCode;
    if (typeof modern === "string" && modern.trim().length > 0) {
      // determine extension: prefer Gate A targetLanguage, else fall back to original file extension
      let ext = ".txt";
      const targetLang = run.gateADecision && run.gateADecision.targetLanguage;
      if (targetLang) {
        const t = String(targetLang).toLowerCase();
        if (t.includes("java")) ext = ".java";
        else if (t.includes("c#") || t.includes("csharp") || t.includes("dotnet") || t.includes("asp.net")) ext = ".cs";
        else if (t.includes("python")) ext = ".py";
        else if (t.includes("php")) ext = ".php";
        else if (t.includes("cobol")) ext = ".cob";
        else if (t.includes("vb")) ext = ".vb";
      } else if (run.assessmentRevisions && run.assessmentRevisions.length) {
        const orig = run.assessmentRevisions[0].inputs && run.assessmentRevisions[0].inputs.fileName;
        if (orig) {
          const e = path.extname(orig);
          if (e) ext = e;
        }
      }

      // Use original input's base name when available so exported file matches input name
      let baseName = "Modernized";
      if (run.assessmentRevisions && run.assessmentRevisions.length) {
        const orig = run.assessmentRevisions[0].inputs && run.assessmentRevisions[0].inputs.fileName;
        if (orig) {
          try {
            baseName = path.parse(orig).name;
          } catch {}
        }
      }

      const modernPath = path.join(outDir, `${baseName}${ext}`);
      fs.writeFileSync(modernPath, modern, "utf8");
    }

    // cloudReadyConfig
    const cfg = run.transformation && run.transformation.cloudReadyConfig;
    if (typeof cfg === "string" && cfg.trim().length > 0) {
      // prefer YAML filename if it looks like YAML
      const cfgPath = cfg.trim().startsWith("#") || cfg.includes("spring:") ? path.join(outDir, "application.yml") : path.join(outDir, "cloud-config.txt");
      fs.writeFileSync(cfgPath, cfg, "utf8");
    }

    // translationAssumptions (array)
    const ta = run.transformation && run.transformation.translationAssumptions;
    if (Array.isArray(ta) && ta.length) {
      fs.writeFileSync(path.join(outDir, "translationAssumptions.txt"), ta.join("\n"), "utf8");
    }

    // metadata
    const meta = {
      id: run.id,
      status: run.status || null,
      gateA: run.gateADecision || null,
      gateB: run.gateBDecision || null,
      createdAt: run.createdAt || null,
    };
    fs.writeFileSync(path.join(outDir, "metadata.json"), JSON.stringify(meta, null, 2), "utf8");
  } catch (err) {
    // best-effort: do not throw, just log to console
    try { console.error("exportRunOutputs error:", err); } catch {}
  }
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
  // export outputs if transformation present
  try { exportRunOutputs(run); } catch {}
  return run;
}

// `updater` receives the current run and returns the new run object.
export function updateRun(id, updater) {
  const runs = listRuns();
  const idx = runs.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  runs[idx] = updater(runs[idx]);
  writeJson(FILES.runs, runs);
  // export outputs for updated run (best-effort)
  try { exportRunOutputs(runs[idx]); } catch {}
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

// Normalized shape (provider/model defaults + `scaling` flags, see
// lib/scaling.js). saveSettings shallow-merges so a partial write never drops
// the rest. Mirrors data/store-sqlite.js.
export function getSettings() {
  const raw = readJson(FILES.settings, {});
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
  writeJson(FILES.settings, merged);
  return merged;
}
