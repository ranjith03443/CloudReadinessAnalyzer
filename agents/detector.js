import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";
import { getPrompt } from "../prompts/loader.js";

// System prompt lives in prompts/detector/<active version>.json — see prompts/README.md.
const SYSTEM = getPrompt("detector", "system");

// Passed to Claude as the forced tool call's input_schema (see shared.js) —
// OpenAI/Azure rely on response_format: json_object plus the prose above.
const RESULT_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "object",
      properties: {
        fileName: { type: "string" },
        language: { type: "string" },
        overview: { type: "string" },
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: ["Deprecated API", "Hardcoded Config", "Cloud Incompatibility"] },
          severity: { type: "string", enum: ["High", "Medium", "Low"] },
          title: { type: "string" },
          location: { type: "string" },
          explanation: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["id", "category", "severity", "title", "explanation", "recommendation"],
      },
    },
  },
  required: ["findings"],
};

export async function detect({ openai, provider, model, code, config, language, fileName }) {
  const user = buildSourceBlock({ code, config, language, fileName });
  const { data: result, usage } = await runJsonAgent({ openai, provider, model, name: "Detection", system: SYSTEM, user, schema: RESULT_SCHEMA });
  if (!Array.isArray(result.findings)) {
    throw agentError("Detection", "missing or invalid 'findings' array");
  }
  return {
    summary:
      result.summary && typeof result.summary === "object"
        ? result.summary
        : { fileName: fileName || "unknown", language: language || ".NET", overview: "" },
    findings: result.findings,
    usage,
  };
}
