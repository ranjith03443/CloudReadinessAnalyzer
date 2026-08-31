// Estimation agent. Split out of the Scoring agent so effort sizing can be a
// distinct step that reads the Strategy Planner's recommendation — a
// cross-tech rewrite should size very differently than a same-language
// modernization of the same code.
import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";

const SYSTEM = `You are the ESTIMATION agent in a multi-agent cloud-migration assessment pipeline. Code Intelligence, Dependency Analysis and Strategy Planner agents have already run (their output is provided to you). Your job is ONLY to size the effort required to carry out the RECOMMENDED migration approach. Do NOT rewrite code, detect issues, or choose the strategy yourself.

Return ONLY a JSON object with this exact shape:
{
  "effortDaysLow": number,
  "effortDaysHigh": number,
  "confidence": "Low" | "Medium" | "High",
  "rationale": string,
  "tasks": [ { "task": string, "effortDays": number } ]
}

Rules:
- Size the effort for the SUPPLIED recommended migration type/target below, not a hypothetical alternative.
- "effortDaysLow"/"effortDaysHigh" are a realistic range in developer-days for ONE file/component (can be fractional, e.g. 0.5). Low <= High. Most same-language remediations take a fraction of a day up to a few days; only approach ~5+ days when the file is large and effectively needs a rewrite.
- A "cross-tech" migration type (rewriting to a different language) should generally carry a noticeably WIDER range and MORE effort than a "same-language" one for comparable code, since full logic translation carries materially more risk than in-place modernization.
- "tasks" breaks the work into 2-6 concrete items, each with its own "effortDays"; items should roughly add up to the estimated range.
- "confidence" reflects how well-scoped the work is: more high-severity unknowns, or a "cross-tech" migration type, should generally lower confidence relative to a well-understood same-language change.
- "rationale" is one or two sentences explaining the estimate; if migrationType is "cross-tech", say so and note the extra risk. Do NOT include any cost, money, or dollar figures — estimate effort only.
- Return valid JSON only, no markdown.`;

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    effortDaysLow: { type: "number" },
    effortDaysHigh: { type: "number" },
    confidence: { type: "string", enum: ["Low", "Medium", "High"] },
    rationale: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task: { type: "string" },
          effortDays: { type: "number" },
        },
        required: ["task", "effortDays"],
      },
    },
  },
  required: ["effortDaysLow", "effortDaysHigh", "tasks"],
};

function buildEstimate(raw) {
  const e = raw && typeof raw === "object" ? raw : {};
  const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  let low = num(e.effortDaysLow);
  let high = num(e.effortDaysHigh);
  const tasks = Array.isArray(e.tasks)
    ? e.tasks
        .filter((t) => t && typeof t === "object")
        .map((t) => ({
          task: typeof t.task === "string" ? t.task : "",
          effortDays: num(t.effortDays) ?? 0,
        }))
        .filter((t) => t.task)
    : [];
  if (low === null || high === null) {
    const sum = tasks.reduce((a, t) => a + t.effortDays, 0);
    if (low === null) low = sum || null;
    if (high === null) high = sum || low;
  }
  if (low !== null && high !== null && low > high) [low, high] = [high, low];

  return {
    effortDaysLow: low,
    effortDaysHigh: high,
    confidence: ["Low", "Medium", "High"].includes(e.confidence) ? e.confidence : "Medium",
    rationale: typeof e.rationale === "string" ? e.rationale : "",
    tasks,
  };
}

export async function estimate({
  openai,
  provider,
  model,
  code,
  config,
  language,
  fileName,
  findings,
  recommendedStrategy,
  migrationType,
  targetLanguage,
  targetArchitecture,
}) {
  const user =
    buildSourceBlock({ code, config, language, fileName }) +
    "\n\n--- ISSUES DETECTED BY THE CODE INTELLIGENCE AGENT ---\n" +
    JSON.stringify(findings || [], null, 2) +
    "\n\n--- RECOMMENDED APPROACH (Strategy Planner) ---\n" +
    JSON.stringify({ recommendedStrategy, migrationType, targetLanguage, targetArchitecture }, null, 2);

  const { data: result, usage } = await runJsonAgent({
    openai,
    provider,
    model,
    name: "Estimation",
    system: SYSTEM,
    user,
    schema: RESULT_SCHEMA,
  });

  if (typeof result.effortDaysLow !== "number" && !Array.isArray(result.tasks)) {
    throw agentError("Estimation", "missing effort estimate");
  }

  return { ...buildEstimate(result), usage };
}
