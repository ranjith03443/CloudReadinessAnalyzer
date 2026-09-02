import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";
import { getPrompt } from "../prompts/loader.js";

// System prompt lives in prompts/scorer/<active version>.json — see prompts/README.md.
const SYSTEM = getPrompt("scorer", "system");

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    cloudReadinessScore: { type: "number" },
    scoreRationale: { type: "string" },
    scoreBreakdown: {
      type: "array",
      items: {
        type: "object",
        properties: {
          layer: { type: "string", enum: ["Code", "Security & Config", "Infrastructure", "Architecture"] },
          score: { type: "number" },
          note: { type: "string" },
        },
        required: ["layer", "score"],
      },
    },
    riskSummary: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["Low", "Medium", "High"] },
        text: { type: "string" },
      },
    },
  },
  required: ["cloudReadinessScore"],
};

export async function score({ openai, provider, model, code, config, language, fileName, findings }) {
  const user =
    buildSourceBlock({ code, config, language, fileName }) +
    "\n\n--- ISSUES DETECTED BY THE CODE INTELLIGENCE AGENT ---\n" +
    JSON.stringify(findings || [], null, 2);
  const { data: result, usage } = await runJsonAgent({ openai, provider, model, name: "Scoring", system: SYSTEM, user, schema: RESULT_SCHEMA });
  if (typeof result.cloudReadinessScore !== "number" || Number.isNaN(result.cloudReadinessScore)) {
    throw agentError("Scoring", "missing or invalid 'cloudReadinessScore'");
  }
  return {
    cloudReadinessScore: result.cloudReadinessScore,
    scoreRationale: typeof result.scoreRationale === "string" ? result.scoreRationale : "",
    scoreBreakdown: Array.isArray(result.scoreBreakdown) ? result.scoreBreakdown : [],
    riskSummary:
      result.riskSummary && typeof result.riskSummary === "object"
        ? result.riskSummary
        : { level: "Medium", text: "" },
    usage,
  };
}
