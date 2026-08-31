import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";

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
};

function buildSystem({ migrationType, targetLanguage, targetCloud }) {
  const secretStore = SECRET_STORE_BY_CLOUD[targetCloud] || "a managed secret store";

  if (migrationType === "cross-tech") {
    return `You are the TRANSFORMATION agent in a multi-agent cloud-migration pipeline, operating in CROSS-TECH mode: a human confirmed at Gate A that this code should be REWRITTEN from its source language into ${targetLanguage}, not just modernized in place. A Code Intelligence agent has already identified issues (provided to you). Your job is ONLY to produce a faithful logic translation into ${targetLanguage} plus its cloud-ready configuration. Do NOT compute a score and do NOT re-list findings.

Translate the supplied code's logic into idiomatic, modern, cloud-native ${targetLanguage}, addressing the detected issues along the way. Externalize configuration to environment variables and/or ${secretStore} references. Because this is a full language translation — not a mechanical rewrite — be conservative: where you are not fully confident the translation preserves the original behavior, note it explicitly rather than silently guessing.

Return ONLY a JSON object with this exact shape:
{
  "modernizedCode": string,
  "cloudReadyConfig": string,
  "translationAssumptions": string[]
}

Rules:
- Use real newlines inside string values.
- "modernizedCode" is the full ${targetLanguage} rewrite of the supplied code's logic.
- "cloudReadyConfig" externalizes configuration for the rewritten code.
- "translationAssumptions" lists every place you had to make a judgment call, infer intent, or could not fully verify behavioral equivalence (e.g. "assumed X library's Y method matches the original's Z call semantics"). For a genuine cross-language rewrite this list is rarely empty — an empty array should be rare, not the default.
- Return valid JSON only, no markdown.`;
  }

  return `You are the TRANSFORMATION agent in a multi-agent cloud-migration pipeline, operating in SAME-LANGUAGE mode: a human confirmed at Gate A that this code should be modernized in place, keeping its current language/platform. A Code Intelligence agent has already identified issues (provided to you). Your job is ONLY to produce the modernized, cloud-ready version of the supplied code and its configuration. Do NOT compute a score and do NOT re-list findings.

Target an idiomatic, modern, cloud-native version of the SAME language/platform. Externalize configuration to environment variables and/or ${secretStore} references. Address the detected issues in the rewrite.

Return ONLY a JSON object with this exact shape:
{
  "modernizedCode": string,
  "cloudReadyConfig": string,
  "translationAssumptions": []
}

Rules:
- Use real newlines inside string values.
- "modernizedCode" must be the full, idiomatic, cloud-ready rewrite of the supplied code, in the SAME language.
- "cloudReadyConfig" externalizes configuration. If no config was provided, infer the config implied by the code.
- "translationAssumptions" is always an empty array in this mode — there is no language change to flag.
- Return valid JSON only, no markdown.`;
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
}) {
  const system = buildSystem({ migrationType, targetLanguage, targetCloud });
  const user =
    buildSourceBlock({ code, config, language, fileName }) +
    `\n\nMigration type: ${migrationType}${targetLanguage ? ` (target language: ${targetLanguage})` : ""}` +
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
