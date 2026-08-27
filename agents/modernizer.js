import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";

const SYSTEM = `You are the MODERNIZATION agent in a multi-agent cloud-migration pipeline. A detection agent has already identified the issues (they are provided to you). Your job is ONLY to produce the modernized, cloud-ready version of the supplied code and its configuration. Do NOT compute a score and do NOT re-list findings.

Target idiomatic .NET 8 / cloud-native designs (or the modern Java equivalent). Externalize configuration to environment variables and/or Azure Key Vault references / appsettings.json (or the equivalent for Java). Address the detected issues in the rewrite.

Return ONLY a JSON object with this exact shape:
{
  "modernizedCode": string,
  "cloudReadyConfig": string
}

Rules:
- Use real newlines inside the string values.
- "modernizedCode" must be the full, idiomatic, cloud-ready rewrite of the supplied code.
- "cloudReadyConfig" externalizes configuration. If no config was provided, infer the config implied by the code.
- Return valid JSON only, no markdown.`;

export async function modernize({ openai, model, code, config, language, fileName, findings }) {
  const user =
    buildSourceBlock({ code, config, language, fileName }) +
    "\n\n--- ISSUES DETECTED BY THE DETECTION AGENT ---\n" +
    JSON.stringify(findings || [], null, 2);
  const { data: result, usage } = await runJsonAgent({ openai, model, name: "Modernization", system: SYSTEM, user });
  if (typeof result.modernizedCode !== "string" || typeof result.cloudReadyConfig !== "string") {
    throw agentError("Modernization", "missing 'modernizedCode' or 'cloudReadyConfig'");
  }
  return {
    modernizedCode: result.modernizedCode,
    cloudReadyConfig: result.cloudReadyConfig,
    usage,
  };
}
