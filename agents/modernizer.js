import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";
import { getPrompt } from "../prompts/loader.js";

// Same result shape in both same-language and cross-tech mode (see
// buildSystem below) — one schema covers both.
const RESULT_SCHEMA = {
  type: "object",
  properties: {
    modernizedCode: { type: "string" },
    cloudReadyConfig: { type: "string" },
    translationAssumptions: { type: "array", items: { type: "string" } },
  },
  required: ["modernizedCode", "cloudReadyConfig", "translationAssumptions"],
};

const SECRET_STORE_BY_CLOUD = {
  Azure: "Azure Key Vault",
  AWS: "AWS Secrets Manager",
  GCP: "GCP Secret Manager",
  "On-premise / portable": "a self-hosted secret store such as HashiCorp Vault or Kubernetes Secrets",
};

// System prompts live in prompts/modernizer/<active version>.json — see prompts/README.md.
// {{targetLanguage}} / {{secretStore}} are filled from the confirmed Gate A choices.
function buildSystem({ migrationType, targetLanguage, targetCloud }) {
  const secretStore = SECRET_STORE_BY_CLOUD[targetCloud] || "a managed secret store";
  const key = migrationType === "cross-tech" ? "systemCrossTech" : "systemSameLanguage";
  return getPrompt("modernizer", key, { targetLanguage: targetLanguage || "", secretStore });
}

export async function modernize({
  openai,
  provider,
  model,
  code,
  config,
  language,
  fileName,
  findings,
  migrationType = "same-language",
  targetLanguage = null,
  targetCloud = null,
  plannerNotes = null,
}) {
  const system = buildSystem({ migrationType, targetLanguage, targetCloud });
  const notesBlock =
    plannerNotes && String(plannerNotes).trim()
      ? `\n\n--- NOTES FROM THE HUMAN (guidelines / constraints — follow these: target versions, banned tech, etc.) ---\n${String(plannerNotes).trim()}`
      : "";
  const user =
    buildSourceBlock({ code, config, language, fileName }) +
    `\n\nMigration type: ${migrationType}${targetLanguage ? ` (target language: ${targetLanguage})` : ""}` +
    `\nDeployment target: ${targetCloud || "(not specified)"}` +
    notesBlock +
    "\n\n--- ISSUES DETECTED BY THE CODE INTELLIGENCE AGENT ---\n" +
    JSON.stringify(findings || [], null, 2);

  // This agent emits the full rewritten file plus its config as JSON string
  // values, so it needs far more output room than the default.
  const { data: result, usage } = await runJsonAgent({
    openai,
    provider,
    model,
    name: "Transformation",
    system,
    user,
    schema: RESULT_SCHEMA,
    maxTokens: 16384,
  });
  if (typeof result.modernizedCode !== "string" || typeof result.cloudReadyConfig !== "string") {
    throw agentError("Transformation", "missing 'modernizedCode' or 'cloudReadyConfig'");
  }
  return {
    modernizedCode: result.modernizedCode,
    cloudReadyConfig: result.cloudReadyConfig,
    translationAssumptions: Array.isArray(result.translationAssumptions) ? result.translationAssumptions : [],
    usage,
  };
}
