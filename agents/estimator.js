// Estimation agent. Split out of the Scoring agent so effort sizing can be a
// distinct step that reads the Strategy Planner's recommendation — a
// cross-tech rewrite should size very differently than a same-language
// modernization of the same code.
import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";
import { getPrompt } from "../prompts/loader.js";

// System prompt lives in prompts/estimator/<active version>.json — see prompts/README.md.
const SYSTEM = getPrompt("estimator", "system");

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
