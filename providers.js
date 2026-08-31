// AI provider registry: which providers/models are available (based on what's
// configured in .env), how to build a client for each, and rough per-token
// pricing for cost estimates. Consolidates what used to be spread across
// server.js (createClient/hasCredentials) and agents/shared.js (PRICING).
import OpenAI, { AzureOpenAI } from "openai";
import Anthropic from "@anthropic-ai/sdk";

// Read every credential lazily from process.env (never captured into a
// module-level const) — this module is statically imported by server.js
// above the dotenv.config() call there, and ES module imports are fully
// evaluated before an importing module's own top-level statements run. A
// top-level `const X = process.env.FOO` here would therefore always
// capture `undefined`, regardless of what's in .env or how many times the
// server is restarted.
const OPENAI_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o4-mini"];
const CLAUDE_MODELS = ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"];

function openaiAvailable() {
  const key = process.env.OPENAI_API_KEY;
  return Boolean(key && key !== "sk-your-key-here");
}
function azureAvailable() {
  return Boolean(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_DEPLOYMENT_ID);
}
function claudeAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export const PROVIDERS = {
  openai: {
    label: "OpenAI",
    available: openaiAvailable,
    models: () => OPENAI_MODELS,
    defaultModel: "gpt-4o",
  },
  azure: {
    label: "Azure OpenAI",
    available: azureAvailable,
    // Azure's "model" is whatever's actually deployed — there's only ever one
    // selectable value, matching the deployment configured in .env.
    models: () => (process.env.AZURE_OPENAI_DEPLOYMENT_ID ? [process.env.AZURE_OPENAI_DEPLOYMENT_ID] : []),
    defaultModel: () => process.env.AZURE_OPENAI_DEPLOYMENT_ID,
  },
  claude: {
    label: "Claude (Anthropic)",
    available: claudeAvailable,
    models: () => CLAUDE_MODELS,
    defaultModel: "claude-sonnet-5",
  },
};

// Lists every provider with its availability and model list — drives the
// New Run and Settings screens' dropdowns.
export function listProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    available: p.available(),
    models: p.models(),
  }));
}

// The first available provider, for defaulting a fresh install with no
// Settings default saved yet.
export function firstAvailableProvider() {
  const found = listProviders().find((p) => p.available && p.models.length);
  if (!found) return null;
  return { provider: found.id, model: found.models[0] };
}

export function isValidSelection(provider, model) {
  const p = PROVIDERS[provider];
  if (!p || !p.available()) return false;
  return p.models().includes(model);
}

export function createClient(provider) {
  if (provider === "azure") {
    return new AzureOpenAI({
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview",
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT_ID,
    });
  }
  if (provider === "claude") {
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// --- Pricing (estimates only) ------------------------------------------------

const PRICING = {
  openai: {
    "gpt-4o-mini": { in: 0.15, out: 0.6 },
    "gpt-4o": { in: 2.5, out: 10 },
    "gpt-4.1-mini": { in: 0.4, out: 1.6 },
    "gpt-4.1": { in: 2, out: 8 },
    "o4-mini": { in: 1.1, out: 4.4 },
  },
  claude: {
    "claude-opus-5": { in: 15, out: 75 },
    "claude-sonnet-5": { in: 3, out: 15 },
    "claude-haiku-4-5-20251001": { in: 0.8, out: 4 },
  },
};
// Azure deployments are priced the same as their underlying OpenAI model;
// since the deployment name is opaque, fall back to gpt-4o-mini's rate.
PRICING.azure = PRICING.openai;

export function estimateCostUsd(provider, model, telemetry) {
  if (!telemetry) return 0;
  const table = PRICING[provider] || PRICING.openai;
  const key = String(model || "").toLowerCase();
  const rateKey = Object.keys(table).find((k) => key.includes(k)) || "gpt-4o-mini";
  const rate = table[rateKey] || table[Object.keys(table)[0]];
  return (
    (telemetry.promptTokens / 1e6) * rate.in +
    (telemetry.completionTokens / 1e6) * rate.out
  );
}
