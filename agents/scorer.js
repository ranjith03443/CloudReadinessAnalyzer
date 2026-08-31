import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";

const SYSTEM = `You are the SCORING / RISK agent in a multi-agent cloud-migration assessment pipeline. A Code Intelligence agent has already identified the issues (they are provided to you). Your job is ONLY to assess migration risk and compute a cloud readiness score. Do NOT rewrite code and do NOT estimate effort — a separate Estimation agent handles that.

Return ONLY a JSON object with this exact shape:
{
  "cloudReadinessScore": number,
  "scoreRationale": string,
  "scoreBreakdown": [
    { "layer": "Code" | "Security & Config" | "Infrastructure" | "Architecture", "score": number, "note": string }
  ],
  "riskSummary": { "level": "Low" | "Medium" | "High", "text": string }
}

Rules:
- "cloudReadinessScore" is an integer 0-100 (100 = fully cloud-ready).
- "scoreBreakdown" has one entry per relevant layer; each "score" is an integer 0-100.
- Base the score and risk on the supplied code, config, and the detected findings. More and more-severe findings should lower the score.
- "riskSummary.text" is a concise plain-English migration risk statement.
- Return valid JSON only, no markdown.`;

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
