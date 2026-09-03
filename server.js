import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { runPipeline } from "./agents/pipeline.js";
import { runDemoPipeline, runDemoAssessment, discussStrategyDemo, runDemoTransformation } from "./agents/demo.js";
import { cloneRepo, cleanupClone, sweepOrphanedClones, assertLocalDirectory, collectSourceFiles, collectConfigFiles } from "./ingest.js";
import { runAssessmentPipeline } from "./agents/assessmentPipeline.js";
import { runTransformPipeline } from "./agents/transformPipeline.js";
import { discussStrategy } from "./agents/strategist.js";
import * as store from "./data/store-sqlite.js";
import { requireRole, getActingRole } from "./roles.js";
import * as providers from "./providers.js";
import { promptVersions } from "./prompts/loader.js";
import { SCALING_LAYERS } from "./lib/scaling.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

// Resolves which provider/model a request should use: an explicit choice in
// the request body, else the saved Settings default, else the first
// available (credentialed) provider. Demo mode never needs real credentials,
// so it always resolves to something usable. Returns either
// { provider, model } or { error } — callers check for `.error`.
function resolveProviderSelection({ provider, model, isDemo }) {
  if (provider && model) {
    if (!isDemo && !providers.isValidSelection(provider, model)) {
      return { error: `The selected provider/model ("${provider}" / "${model}") is not available. Check its credentials in .env, or pick another in Settings.` };
    }
    return { provider, model };
  }
  const settings = store.getSettings();
  if (settings.defaultProvider && settings.defaultModel) {
    if (isDemo || providers.isValidSelection(settings.defaultProvider, settings.defaultModel)) {
      return { provider: settings.defaultProvider, model: settings.defaultModel };
    }
  }
  const first = providers.firstAvailableProvider();
  if (first) return first;
  if (isDemo) return { provider: "openai", model: "gpt-4o-mini" };
  return { error: "No AI provider is configured. Set OPENAI_API_KEY, AZURE_OPENAI_*, or ANTHROPIC_API_KEY in your .env, or run in demo mode." };
}

// Appends one cost-ledger entry per agent call in `telemetry.stages` — the
// "every individual AI call" granularity the Cost & Budget screen needs, not
// just a per-run rollup.
function logCostEntries({ runId, revision, phase, provider, model, telemetry }) {
  if (!telemetry || !Array.isArray(telemetry.stages)) return;
  for (const stage of telemetry.stages) {
    store.appendCost({
      runId,
      revision,
      phase,
      agent: stage.stage,
      provider,
      model,
      usage: { promptTokens: stage.promptTokens, completionTokens: stage.completionTokens, totalTokens: stage.totalTokens },
      costUsd: providers.estimateCostUsd(provider, model, stage),
    });
  }
}

// Remove any clone temp dirs left behind by a prior crashed run.
sweepOrphanedClones();

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/samples", express.static(path.join(__dirname, "samples")));

// Repository ingestion: clone a public git URL, or read a local folder
// already on disk, and collect the source files matching `language` into the
// same combined-source shape the browser's file/folder picker already
// produces. See ingest.js for the clone/walk/cap logic.
app.post("/api/ingest", async (req, res) => {
  const { sourceType, repoUrl, branch, localPath, language } = req.body || {};

  if (sourceType !== "repoUrl" && sourceType !== "localPath") {
    return res.status(400).json({ error: "sourceType must be \"repoUrl\" or \"localPath\"." });
  }
  if (!language || !String(language).trim()) {
    return res.status(400).json({ error: "language is required." });
  }

  let dir = null;
  let isClone = false;
  try {
    if (sourceType === "repoUrl") {
      if (!repoUrl || !String(repoUrl).trim()) {
        return res.status(400).json({ error: "repoUrl is required." });
      }
      dir = await cloneRepo(repoUrl, branch);
      isClone = true;
    } else {
      dir = assertLocalDirectory(localPath);
    }

    const { code, filesIncluded, filesTotal, truncated } = collectSourceFiles(dir, language);

    if (filesIncluded === 0) {
      const where = sourceType === "repoUrl" ? "repository" : "folder";
      return res.status(400).json({
        error: `No files matching "${language}" were found in the ${where}.`,
      });
    }

    // Config files (web.config, appsettings*.json, application*.yml, …) are
    // detected here so the user never has to hand-attach them — see ingest.js.
    const { config, files: configFiles } = collectConfigFiles(dir);

    const fileName =
      sourceType === "repoUrl"
        ? String(repoUrl).split("/").filter(Boolean).pop().replace(/\.git$/i, "")
        : path.basename(dir);

    return res.json({ fileName, code, filesIncluded, filesTotal, truncated, config, configFiles });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Ingestion failed." });
  } finally {
    if (isClone) cleanupClone(dir);
  }
});

// --- Two-phase pipeline: Phase 1 (assessment) + Gate A -----------------------
// Runs the 5-agent assessment graph and persists the run at "pending_gate_a".
// No code is generated in this phase.

async function runPhase1({
  code,
  config,
  fileName,
  language,
  targetCloud,
  targetArchitecturePattern,
  preferredMigrationType,
  preferredTargetLanguage,
  plannerNotes,
  isDemo,
  provider,
  model,
  send,
}) {
  let result;
  if (isDemo) {
    result = await runDemoAssessment(
      { code, config, language, fileName, targetCloud, targetArchitecturePattern, preferredMigrationType, preferredTargetLanguage, plannerNotes },
      send
    );
  } else {
    const openai = providers.createClient(provider);
    const ctx = {
      openai,
      provider,
      model,
      code,
      config,
      language,
      fileName,
      targetCloud,
      targetArchitecturePattern,
      preferredMigrationType,
      preferredTargetLanguage,
      plannerNotes,
    };
    result = await runAssessmentPipeline(ctx, send);
  }

  if (result?.telemetry) {
    if (!result.telemetry.provider) result.telemetry.provider = provider;
    if (!result.telemetry.model) result.telemetry.model = model;
    if (typeof result.telemetry.estimatedCostUsd !== "number") {
      result.telemetry.estimatedCostUsd = providers.estimateCostUsd(provider, model, result.telemetry);
    }
  }

  const validShape =
    result &&
    typeof result.cloudReadinessScore === "number" &&
    Array.isArray(result.findings) &&
    typeof result.recommendedStrategy === "string";

  return { result, validShape };
}

app.post("/api/runs", async (req, res) => {
  const {
    code,
    fileName,
    config,
    language,
    targetCloud,
    targetArchitecturePattern,
    preferredMigrationType,
    preferredTargetLanguage,
    plannerNotes,
    demo,
  } = req.body || {};
  const actingRole = getActingRole(req);
  const isDemo = demo === true || process.env.DEMO_MODE === "1";

  if (!code || !String(code).trim()) {
    return res.status(400).json({ error: "No code was provided to analyze." });
  }
  if (!language || !String(language).trim()) {
    return res.status(400).json({ error: "language is required." });
  }
  if (!targetCloud || !String(targetCloud).trim()) {
    return res.status(400).json({ error: "A deployment target is required." });
  }

  const selection = resolveProviderSelection({ provider: req.body.provider, model: req.body.model, isDemo });
  if (selection.error) {
    return res.status(400).json({ error: selection.error });
  }
  const { provider, model } = selection;

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (obj) => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(obj) + "\n");
  };

  try {
    const { result, validShape } = await runPhase1({
      code, config, fileName, language, targetCloud, targetArchitecturePattern,
      preferredMigrationType, preferredTargetLanguage, plannerNotes, isDemo, provider, model, send,
    });

    if (!validShape) {
      send({ type: "error", error: "The assessment produced an incomplete result. Please try again." });
      return res.end();
    }

    const now = new Date().toISOString();
    const runId = store.newId();
    const run = {
      id: runId,
      actingRole,
      createdAt: now,
      assessmentRevisions: [
        {
          revision: 1,
          inputs: {
            code, config, fileName, language, targetCloud, targetArchitecturePattern,
            preferredMigrationType, preferredTargetLanguage, plannerNotes, provider, model,
          },
          result,
          createdAt: now,
        },
      ],
      currentRevision: 1,
      strategyConversation: [],
      gateADecision: null,
      transformation: null,
      status: "pending_gate_a",
      gateBDecision: null,
    };
    store.insertRun(run);
    logCostEntries({ runId, revision: 1, phase: "assessment", provider, model, telemetry: result.telemetry });
    store.appendAudit({
      actingRole,
      action: "assessment_completed",
      runId: run.id,
      details: {
        fileName,
        language,
        targetCloud,
        targetArchitecturePattern,
        provider,
        model,
        cloudReadinessScore: result.cloudReadinessScore,
        recommendedStrategy: result.recommendedStrategy,
      },
    });

    send({ type: "result", data: { ...result, preferredMigrationType, preferredTargetLanguage, runId: run.id, revision: 1 } });
    return res.end();
  } catch (err) {
    const message = err?.error?.message || err?.message || "Assessment failed.";
    console.error("[runs] error:", message);
    send({ type: "error", error: message });
    return res.end();
  }
});

app.post("/api/runs/:id/reassess", async (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found." });
  if (run.status !== "pending_gate_a") {
    return res.status(409).json({
      error: `This run is past Gate A (status: "${run.status}") and its inputs are locked — start a new run instead.`,
    });
  }

  const {
    code,
    fileName,
    config,
    language,
    targetCloud,
    targetArchitecturePattern,
    preferredMigrationType,
    preferredTargetLanguage,
    plannerNotes,
    demo,
  } = req.body || {};
  const actingRole = getActingRole(req);
  const isDemo = demo === true || process.env.DEMO_MODE === "1";

  if (!code || !String(code).trim()) {
    return res.status(400).json({ error: "No code was provided to analyze." });
  }
  if (!language || !String(language).trim()) {
    return res.status(400).json({ error: "language is required." });
  }
  if (!targetCloud || !String(targetCloud).trim()) {
    return res.status(400).json({ error: "A deployment target is required." });
  }

  const priorInputs = run.assessmentRevisions[run.assessmentRevisions.length - 1].inputs;
  const selection = resolveProviderSelection({
    provider: req.body.provider || priorInputs.provider,
    model: req.body.model || priorInputs.model,
    isDemo,
  });
  if (selection.error) {
    return res.status(400).json({ error: selection.error });
  }
  const { provider, model } = selection;

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (obj) => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(obj) + "\n");
  };

  try {
    const { result, validShape } = await runPhase1({
      code, config, fileName, language, targetCloud, targetArchitecturePattern,
      preferredMigrationType, preferredTargetLanguage, plannerNotes, isDemo, provider, model, send,
    });

    if (!validShape) {
      send({ type: "error", error: "The assessment produced an incomplete result. Please try again." });
      return res.end();
    }

    const changed = [];
    if (priorInputs.language !== language) changed.push(`language: ${priorInputs.language} -> ${language}`);
    if (priorInputs.targetCloud !== targetCloud) changed.push(`targetCloud: ${priorInputs.targetCloud} -> ${targetCloud}`);
    if (priorInputs.targetArchitecturePattern !== targetArchitecturePattern) {
      changed.push(
        `targetArchitecturePattern: ${priorInputs.targetArchitecturePattern || "(let AI recommend)"} -> ${targetArchitecturePattern || "(let AI recommend)"}`
      );
    }
    if (priorInputs.preferredMigrationType !== (preferredMigrationType || null)) {
      changed.push(`migration goal: ${priorInputs.preferredMigrationType || "(let AI decide)"} -> ${preferredMigrationType || "(let AI decide)"}`);
    }
    if (priorInputs.code !== code) changed.push("source code changed");
    if (priorInputs.provider !== provider || priorInputs.model !== model) changed.push(`provider/model: ${priorInputs.provider}/${priorInputs.model} -> ${provider}/${model}`);

    const revision = run.currentRevision + 1;
    const now = new Date().toISOString();
    store.updateRun(run.id, (r) => ({
      ...r,
      assessmentRevisions: [
        ...r.assessmentRevisions,
        {
          revision,
          inputs: {
            code, config, fileName, language, targetCloud, targetArchitecturePattern,
            preferredMigrationType, preferredTargetLanguage, plannerNotes, provider, model,
          },
          result,
          createdAt: now,
        },
      ],
      currentRevision: revision,
    }));
    logCostEntries({ runId: run.id, revision, phase: "assessment", provider, model, telemetry: result.telemetry });

    store.appendAudit({ actingRole, action: "reassessed", runId: run.id, details: { revision, changed } });

    send({ type: "result", data: { ...result, preferredMigrationType, preferredTargetLanguage, runId: run.id, revision } });
    return res.end();
  } catch (err) {
    const message = err?.error?.message || err?.message || "Reassessment failed.";
    console.error("[reassess] error:", message);
    send({ type: "error", error: message });
    return res.end();
  }
});

app.post("/api/runs/:id/strategy-chat", async (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found." });
  if (run.status !== "pending_gate_a") {
    return res.status(409).json({ error: "This run is past Gate A; the strategy chat is no longer available." });
  }

  const { message, demo } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: "message is required." });
  }
  const isDemo = demo === true || process.env.DEMO_MODE === "1";

  const revisionRecord = run.assessmentRevisions.find((r) => r.revision === run.currentRevision);
  const { inputs, result } = revisionRecord;
  const actingRole = getActingRole(req);

  const selection = resolveProviderSelection({ provider: inputs.provider, model: inputs.model, isDemo });
  if (selection.error) {
    return res.status(400).json({ error: selection.error });
  }
  const { provider, model } = selection;

  try {
    let reply;
    if (isDemo) {
      reply = await discussStrategyDemo({
        userMessage: message,
        initialRecommendation: {
          migrationType: result.migrationType,
          targetLanguage: result.targetLanguage,
          targetArchitecture: result.targetArchitecture,
        },
      });
    } else {
      const openai = providers.createClient(provider);
      reply = await discussStrategy({
        openai,
        provider,
        model,
        code: inputs.code,
        config: inputs.config,
        language: inputs.language,
        fileName: inputs.fileName,
        findings: result.findings,
        dependencies: result.dependencies,
        targetCloud: inputs.targetCloud,
        targetArchitecturePattern: inputs.targetArchitecturePattern,
        plannerNotes: inputs.plannerNotes,
        initialRecommendation: {
          recommendedStrategy: result.recommendedStrategy,
          migrationType: result.migrationType,
          targetLanguage: result.targetLanguage,
          targetArchitecture: result.targetArchitecture,
        },
        conversation: run.strategyConversation,
        userMessage: message,
      });
    }

    if (reply.usage) {
      store.appendCost({
        runId: run.id,
        revision: run.currentRevision,
        phase: "strategy-chat",
        agent: "strategize-chat",
        provider,
        model,
        usage: reply.usage,
        costUsd: providers.estimateCostUsd(provider, model, reply.usage),
      });
    }

    const now = new Date().toISOString();
    store.updateRun(run.id, (r) => ({
      ...r,
      strategyConversation: [
        ...r.strategyConversation,
        { role: "user", content: message, ts: now },
        { role: "assistant", content: reply.reply, ts: new Date().toISOString() },
      ],
    }));

    res.json({
      reply: reply.reply,
      suggestedMigrationType: reply.suggestedMigrationType,
      suggestedTargetLanguage: reply.suggestedTargetLanguage,
      suggestedTargetArchitecturePattern: reply.suggestedTargetArchitecturePattern,
    });
  } catch (err) {
    const message2 = err?.error?.message || err?.message || "Strategy chat failed.";
    console.error("[strategy-chat] error:", message2);
    res.status(500).json({ error: message2 });
  }
});

app.get("/api/runs", (_req, res) => {
  const runs = store
    .listRuns()
    .map((r) => {
      const rev = r.assessmentRevisions[r.assessmentRevisions.length - 1];
      return {
        id: r.id,
        createdAt: r.createdAt,
        fileName: rev?.inputs?.fileName || null,
        language: rev?.inputs?.language || null,
        status: r.status,
        cloudReadinessScore: rev?.result?.cloudReadinessScore ?? null,
      };
    })
    // Newest first — most-recent runs are what you usually want to find.
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ runs });
});

app.get("/api/runs/:id", (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found." });
  res.json(run);
});

// Gate A: architect-role only. "stop" ends the run here (a legitimate
// outcome — no code is ever generated) and responds immediately. "proceed"
// runs Phase 2 (Transformation + Validation) with the confirmed values and
// streams its progress the same way Phase 1 does, since it's a real
// multi-agent call, not an instant decision.
app.post("/api/runs/:id/gate-a", requireRole("architect"), async (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found." });
  if (run.status !== "pending_gate_a") {
    return res.status(409).json({ error: `Gate A has already been decided for this run (status: "${run.status}").` });
  }

  const { action, migrationType, targetLanguage, targetArchitecturePattern, demo } = req.body || {};
  if (action !== "proceed" && action !== "stop") {
    return res.status(400).json({ error: "action must be \"proceed\" or \"stop\"." });
  }

  const actingRole = getActingRole(req);
  const now = new Date().toISOString();

  if (action === "stop") {
    const gateADecision = {
      action: "stop",
      revision: run.currentRevision,
      migrationType: migrationType || null,
      targetLanguage: targetLanguage || null,
      targetArchitecturePattern: targetArchitecturePattern || null,
      decidedByRole: actingRole,
      decidedAt: now,
    };
    store.updateRun(run.id, (r) => ({ ...r, gateADecision, status: "stopped" }));
    store.appendAudit({ actingRole, action: "gate_a_stopped", runId: run.id, details: { revision: run.currentRevision } });
    return res.json({ status: "stopped", gateADecision });
  }

  // action === "proceed"
  if (!migrationType || (migrationType !== "same-language" && migrationType !== "cross-tech")) {
    return res.status(400).json({ error: "migrationType must be \"same-language\" or \"cross-tech\"." });
  }
  if (migrationType === "cross-tech" && !targetLanguage) {
    return res.status(400).json({ error: "targetLanguage is required when migrationType is \"cross-tech\"." });
  }

  const isDemo = demo === true || process.env.DEMO_MODE === "1";
  const revisionRecord = run.assessmentRevisions.find((r) => r.revision === run.currentRevision);
  const { inputs, result: assessment } = revisionRecord;

  const selection = resolveProviderSelection({ provider: inputs.provider, model: inputs.model, isDemo });
  if (selection.error) {
    return res.status(400).json({ error: selection.error });
  }
  const { provider, model } = selection;
  const resolvedArchPattern = targetArchitecturePattern || inputs.targetArchitecturePattern || null;

  const gateADecision = {
    action: "proceed",
    revision: run.currentRevision,
    migrationType,
    targetLanguage: migrationType === "cross-tech" ? targetLanguage : null,
    targetArchitecturePattern: resolvedArchPattern,
    decidedByRole: actingRole,
    decidedAt: now,
  };

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (obj) => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(obj) + "\n");
  };

  try {
    const transformCtx = {
      code: inputs.code,
      config: inputs.config,
      language: inputs.language,
      fileName: inputs.fileName,
      findings: assessment.findings,
      migrationType,
      targetLanguage: gateADecision.targetLanguage,
      targetCloud: inputs.targetCloud,
      targetArchitecturePattern: resolvedArchPattern,
      plannerNotes: inputs.plannerNotes,
    };

    let transformResult;
    if (isDemo) {
      transformResult = await runDemoTransformation(transformCtx, send);
    } else {
      const openai = providers.createClient(provider);
      transformResult = await runTransformPipeline({ openai, provider, model, ...transformCtx }, send);
    }

    if (transformResult?.telemetry) {
      if (!transformResult.telemetry.provider) transformResult.telemetry.provider = provider;
      if (!transformResult.telemetry.model) transformResult.telemetry.model = model;
      if (typeof transformResult.telemetry.estimatedCostUsd !== "number") {
        transformResult.telemetry.estimatedCostUsd = providers.estimateCostUsd(provider, model, transformResult.telemetry);
      }
    }

    const validShape = transformResult && typeof transformResult.modernizedCode === "string";
    if (!validShape) {
      send({ type: "error", error: "The transformation produced an incomplete result. Please try again." });
      return res.end();
    }

    store.updateRun(run.id, (r) => ({
      ...r,
      gateADecision,
      transformation: transformResult,
      status: "pending_gate_b",
    }));
    logCostEntries({ runId: run.id, revision: run.currentRevision, phase: "transformation", provider, model, telemetry: transformResult.telemetry });
    store.appendAudit({
      actingRole,
      action: "gate_a_proceeded",
      runId: run.id,
      details: { revision: run.currentRevision, migrationType, targetLanguage: gateADecision.targetLanguage },
    });
    store.appendAudit({
      actingRole,
      action: "transformation_completed",
      runId: run.id,
      details: { manualReviewRecommended: transformResult.manualReviewRecommended },
    });

    send({ type: "result", data: { ...transformResult, runId: run.id } });
    return res.end();
  } catch (err) {
    const message = err?.error?.message || err?.message || "Transformation failed.";
    console.error("[gate-a proceed] error:", message);
    send({ type: "error", error: message });
    return res.end();
  }
});

// Gate B: architect-role only, final sign-off on the transformation output.
app.post("/api/runs/:id/gate-b", requireRole("architect"), (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found." });
  if (run.status !== "pending_gate_b") {
    return res.status(409).json({ error: `Gate B is not available for this run (status: "${run.status}").` });
  }

  const { action, comment } = req.body || {};
  if (action !== "approve" && action !== "reject") {
    return res.status(400).json({ error: "action must be \"approve\" or \"reject\"." });
  }

  const actingRole = getActingRole(req);
  const now = new Date().toISOString();
  const gateBDecision = { decidedByRole: actingRole, decidedAt: now, comment: comment || null };
  const status = action === "approve" ? "approved" : "rejected";

  store.updateRun(run.id, (r) => ({ ...r, gateBDecision, status }));
  store.appendAudit({
    actingRole,
    action: action === "approve" ? "gate_b_approved" : "gate_b_rejected",
    runId: run.id,
    details: { comment: comment || null },
  });

  return res.json({ status, gateBDecision });
});

// Audit log: architect-role only. Read-only view of every logged action
// across every run.
app.get("/api/audit", requireRole("architect"), (req, res) => {
  const { runId } = req.query;
  let entries = store.listAudit();
  if (runId) entries = entries.filter((e) => e.runId === runId);
  res.json({ audit: entries });
});

// --- AI provider selection & cost tracking (Part 5) --------------------------

app.get("/api/settings/providers", (_req, res) => {
  res.json({ providers: providers.listProviders() });
});

app.get("/api/settings/default", (_req, res) => {
  const saved = store.getSettings();
  if (saved.defaultProvider && saved.defaultModel) {
    return res.json(saved);
  }
  const first = providers.firstAvailableProvider();
  res.json({ defaultProvider: first?.provider || null, defaultModel: first?.model || null });
});

app.post("/api/settings/default", requireRole("architect"), (req, res) => {
  const { provider, model } = req.body || {};
  if (!provider || !model) {
    return res.status(400).json({ error: "provider and model are required." });
  }
  if (!providers.isValidSelection(provider, model)) {
    return res.status(400).json({ error: `"${provider}" / "${model}" is not an available provider/model.` });
  }
  const settings = store.saveSettings({ defaultProvider: provider, defaultModel: model });
  store.appendAudit({ actingRole: getActingRole(req), action: "settings_default_changed", runId: null, details: { provider, model } });
  res.json(settings);
});

// --- Scaling layers (RAG + agent cache) -------------------------------------
// These layers are SCAFFOLDED in lib/ but not wired into the pipeline. The
// flags persist and are audited so the decision is on record; while each
// layer's status is "scaffolded" they change no pipeline behavior. See
// lib/README.md and lib/scaling.js.

app.get("/api/settings/scaling", (_req, res) => {
  const { scaling } = store.getSettings();
  res.json({ scaling, layers: SCALING_LAYERS });
});

app.post("/api/settings/scaling", requireRole("architect"), (req, res) => {
  const { rag, cache } = req.body || {};
  const patch = {};
  if (rag && typeof rag.enabled === "boolean") patch.rag = { enabled: rag.enabled };
  if (cache && typeof cache.enabled === "boolean") patch.cache = { enabled: cache.enabled };
  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: "Provide rag.enabled and/or cache.enabled as booleans." });
  }
  const settings = store.saveSettings({ scaling: patch });
  store.appendAudit({
    actingRole: getActingRole(req),
    action: "settings_scaling_changed",
    runId: null,
    details: settings.scaling,
  });
  res.json({ scaling: settings.scaling, layers: SCALING_LAYERS });
});

// Cost ledger: architect-role only. Every individual AI call, filterable by
// date range and/or run, with aggregate totals.
app.get("/api/cost", requireRole("architect"), (req, res) => {
  const { runId, dateFrom, dateTo } = req.query;
  let entries = store.listCost();

  if (runId) entries = entries.filter((e) => e.runId === runId);
  if (dateFrom) {
    const from = new Date(dateFrom).getTime();
    entries = entries.filter((e) => new Date(e.ts).getTime() >= from);
  }
  if (dateTo) {
    const to = new Date(dateTo).getTime();
    entries = entries.filter((e) => new Date(e.ts).getTime() <= to);
  }

  const totals = entries.reduce(
    (acc, e) => {
      acc.totalCostUsd += e.costUsd || 0;
      acc.totalTokens += e.totalTokens || 0;
      acc.byDay[e.ts.slice(0, 10)] = (acc.byDay[e.ts.slice(0, 10)] || 0) + (e.costUsd || 0);
      acc.byProvider[e.provider] = (acc.byProvider[e.provider] || 0) + (e.costUsd || 0);
      acc.byModel[e.model] = (acc.byModel[e.model] || 0) + (e.costUsd || 0);
      acc.byAgent[e.agent] = (acc.byAgent[e.agent] || 0) + (e.costUsd || 0);
      return acc;
    },
    { totalCostUsd: 0, totalTokens: 0, byDay: {}, byProvider: {}, byModel: {}, byAgent: {} }
  );

  res.json({ entries, totals });
});

app.post("/api/analyze", async (req, res) => {
  const { code, fileName, config, language, demo } = req.body || {};

  // Demo mode runs the pipeline with canned results and NO OpenAI key, so the
  // multi-agent flow can be shown end-to-end before a key is configured. It is
  // enabled per-request (body `demo: true`) or globally via DEMO_MODE=1.
  const isDemo = demo === true || process.env.DEMO_MODE === "1";

  if (!code || !String(code).trim()) {
    return res.status(400).json({ error: "No code was provided to analyze." });
  }

  const selection = resolveProviderSelection({ isDemo });
  if (selection.error) {
    return res.status(400).json({ error: selection.error });
  }
  const { provider, model } = selection;

  // Stream pipeline progress as newline-delimited JSON (NDJSON).
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (obj) => {
    // Guard against writing after the response has been ended (e.g. a parallel
    // agent resolving after an earlier failure already closed the stream).
    if (res.writableEnded) return;
    res.write(JSON.stringify(obj) + "\n");
  };

  try {
    let result;
    if (isDemo) {
      result = await runDemoPipeline({ code, config, language, fileName }, send);
    } else {
      const openai = providers.createClient(provider);
      const ctx = { openai, provider, model, code, config, language, fileName };
      result = await runPipeline(ctx, send);
    }

    // Enrich telemetry with the active provider/model and an estimated cost so
    // the UI can show run stats. Demo runs already carry their own provider/model.
    if (result?.telemetry) {
      if (!result.telemetry.provider) result.telemetry.provider = provider;
      if (!result.telemetry.model) result.telemetry.model = model;
      if (typeof result.telemetry.estimatedCostUsd !== "number") {
        result.telemetry.estimatedCostUsd = providers.estimateCostUsd(provider, model, result.telemetry);
      }
    }

    const validShape =
      result &&
      typeof result.cloudReadinessScore === "number" &&
      Array.isArray(result.findings);
    if (!validShape) {
      send({
        type: "error",
        error: "The pipeline produced an incomplete analysis. Please try again.",
      });
      return res.end();
    }

    send({ type: "result", data: result });
    return res.end();
  } catch (err) {
    const message = err?.error?.message || err?.message || "Analysis failed.";
    console.error("[analyze] error:", message);
    send({ type: "error", error: message });
    return res.end();
  }
});

app.get("/api/health", (_req, res) => {
  const selection = resolveProviderSelection({ isDemo: false });
  res.json({
    ok: true,
    provider: selection.provider || null,
    model: selection.model || null,
    hasKey: !selection.error,
  });
});

app.listen(PORT, () => {
  const selection = resolveProviderSelection({ isDemo: false });
  console.log("");
  console.log("  ShiftWise — Transformation Platform");
  console.log(`  Running at:  http://localhost:${PORT}`);
  if (selection.error) {
    console.log("");
    console.log("  [!] No AI provider configured. Copy .env.example to .env and add an OpenAI,");
    console.log("      Azure OpenAI, or Anthropic key. Demo mode works without one.");
  } else {
    console.log(`  Provider:    ${providers.PROVIDERS[selection.provider]?.label || selection.provider}`);
    console.log(`  Model:       ${selection.model}`);
  }
  const versions = promptVersions();
  console.log(
    `  Prompts:     ${Object.entries(versions).map(([id, v]) => `${id}@${v}`).join("  ")}`
  );
  const { scaling } = store.getSettings();
  console.log(
    `  Scaling:     RAG scaffold (${scaling.rag.enabled ? "flagged on" : "off"}) · ` +
      `agent-cache scaffold (${scaling.cache.enabled ? "flagged on" : "off"}) — not wired into the pipeline`
  );
  console.log("");
});
