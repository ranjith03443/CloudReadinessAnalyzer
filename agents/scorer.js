import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";

const SYSTEM = `You are the SCORING agent in a multi-agent cloud-migration pipeline. A detection agent has already identified the issues (they are provided to you). Your job is ONLY to assess migration risk, compute a cloud readiness score, and estimate the effort to remediate. Do NOT rewrite code.

Return ONLY a JSON object with this exact shape:
{
  "cloudReadinessScore": number,
  "scoreRationale": string,
  "scoreBreakdown": [
    { "layer": "Code" | "Security & Config" | "Infrastructure" | "Architecture", "score": number, "note": string }
  ],
  "riskSummary": { "level": "Low" | "Medium" | "High", "text": string },
  "migrationEstimate": {
    "effortDaysLow": number,
    "effortDaysHigh": number,
    "confidence": "Low" | "Medium" | "High",
    "rationale": string,
    "tasks": [ { "task": string, "effortDays": number } ]
  }
}

Rules:
- "cloudReadinessScore" is an integer 0-100 (100 = fully cloud-ready).
- "scoreBreakdown" has one entry per relevant layer; each "score" is an integer 0-100.
- Base the score and risk on the supplied code, config, and the detected findings. More and more-severe findings should lower the score.
- "riskSummary.text" is a concise plain-English migration risk statement.
- "migrationEstimate" sizes the remediation work to make THIS single file/component cloud-ready:
  - "effortDaysLow"/"effortDaysHigh" are a realistic range in developer-days for ONE file (can be fractional, e.g. 0.5). Low <= High. Most single-file remediations take a fraction of a day up to a few days; only approach ~5 days when the file is large and effectively needs a rewrite. Do NOT inflate to weeks.
  - "tasks" breaks the work into 2-6 concrete items, each with its own "effortDays"; the items should roughly add up to the estimated range.
  - "confidence" reflects how well-scoped the work is (more high-severity unknowns = lower confidence).
  - "rationale" is one or two sentences explaining the estimate. Do NOT include any cost, money, or dollar figures — estimate effort only.
- Return valid JSON only, no markdown.`;

// Normalize the model's effort estimate (effort only — no cost).
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
  // Fall back to the summed task effort if a bound is missing.
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

export async function score({ openai, model, code, config, language, fileName, findings }) {
  const user =
    buildSourceBlock({ code, config, language, fileName }) +
    "\n\n--- ISSUES DETECTED BY THE DETECTION AGENT ---\n" +
    JSON.stringify(findings || [], null, 2);
  const { data: result, usage } = await runJsonAgent({ openai, model, name: "Scoring", system: SYSTEM, user });
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
    migrationEstimate: buildEstimate(result.migrationEstimate),
    usage,
  };
}
