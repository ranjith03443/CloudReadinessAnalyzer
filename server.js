import express from "express";
import dotenv from "dotenv";
import OpenAI, { AzureOpenAI } from "openai";
import path from "path";
import { fileURLToPath } from "url";
import { runPipeline } from "./agents/pipeline.js";
import { runDemoPipeline } from "./agents/demo.js";
import { estimateCostUsd } from "./agents/shared.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

// --- Provider configuration ---------------------------------------------------
// The analyzer can talk to either standard OpenAI (OPENAI_API_KEY) or an
// Azure OpenAI deployment / Azure-compatible gateway (AZURE_OPENAI_* vars).
// Azure takes priority when its variables are present.
const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT_ID;
const AZURE_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview";
const USE_AZURE = Boolean(AZURE_ENDPOINT && AZURE_API_KEY && AZURE_DEPLOYMENT);

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const PROVIDER = USE_AZURE ? "azure" : "openai";
// For Azure, the "model" sent to the API is the deployment id.
const MODEL = USE_AZURE ? AZURE_DEPLOYMENT : OPENAI_MODEL;

// Warn if Azure is partially configured: some AZURE_OPENAI_* vars are set but
// not all three required ones, so the app silently falls back to OpenAI.
const AZURE_ANY = Boolean(AZURE_ENDPOINT || AZURE_API_KEY || AZURE_DEPLOYMENT);
const AZURE_PARTIAL = AZURE_ANY && !USE_AZURE;

// True when usable credentials are configured for the active provider.
function hasCredentials() {
  if (USE_AZURE) return true;
  return Boolean(OPENAI_KEY && OPENAI_KEY !== "sk-your-key-here");
}

// Builds the right SDK client for the active provider.
function createClient() {
  if (USE_AZURE) {
    return new AzureOpenAI({
      endpoint: AZURE_ENDPOINT,
      apiKey: AZURE_API_KEY,
      apiVersion: AZURE_API_VERSION,
      deployment: AZURE_DEPLOYMENT,
    });
  }
  return new OpenAI({ apiKey: OPENAI_KEY });
}

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/samples", express.static(path.join(__dirname, "samples")));

app.post("/api/analyze", async (req, res) => {
  const { code, fileName, config, language, demo } = req.body || {};

  // Demo mode runs the pipeline with canned results and NO OpenAI key, so the
  // multi-agent flow can be shown end-to-end before a key is configured. It is
  // enabled per-request (body `demo: true`) or globally via DEMO_MODE=1.
  const isDemo = demo === true || process.env.DEMO_MODE === "1";

  if (!isDemo && !hasCredentials()) {
    return res.status(400).json({
      error:
        "No API credentials configured. Set OPENAI_API_KEY (or the AZURE_OPENAI_* variables) in your .env, then restart the server. Or click \u201cRun demo\u201d to see it without a key.",
    });
  }

  if (!code || !String(code).trim()) {
    return res.status(400).json({ error: "No code was provided to analyze." });
  }

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
      const openai = createClient();
      const ctx = { openai, model: MODEL, code, config, language, fileName };
      result = await runPipeline(ctx, send);
    }

    // Enrich telemetry with the active provider/model and an estimated cost so
    // the UI can show run stats. Demo runs already carry their own provider/model.
    if (result?.telemetry) {
      if (!result.telemetry.provider) result.telemetry.provider = PROVIDER;
      if (!result.telemetry.model) result.telemetry.model = MODEL;
      if (typeof result.telemetry.estimatedCostUsd !== "number") {
        result.telemetry.estimatedCostUsd = estimateCostUsd(
          result.telemetry.model,
          result.telemetry
        );
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
  res.json({
    ok: true,
    provider: PROVIDER,
    model: MODEL,
    hasKey: hasCredentials(),
  });
});

app.listen(PORT, () => {
  console.log("");
  console.log("  ShiftWise — Cloud Readiness Analyzer");
  console.log(`  Running at:  http://localhost:${PORT}`);
  console.log(`  Provider:    ${USE_AZURE ? "Azure OpenAI" : "OpenAI"}`);
  console.log(`  Model:       ${MODEL}`);
  if (AZURE_PARTIAL) {
    console.log("");
    console.log("  [!] Some AZURE_OPENAI_* variables are set but not all three required");
    console.log("      (ENDPOINT, API_KEY, DEPLOYMENT_ID). Falling back to standard OpenAI.");
  }
  if (!hasCredentials()) {
    console.log("");
    console.log("  [!] No API credentials found. Copy .env.example to .env and add your OpenAI or Azure OpenAI key.");
  }
  console.log("");
});
