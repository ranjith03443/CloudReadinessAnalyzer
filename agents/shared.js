// Shared helpers used by every agent in the pipeline.

// Builds a labelled error for when an agent returns JSON that is missing or has
// an invalid required field. The pipeline turns this into a stream error event
// rather than producing a semantically wrong result.
export function agentError(name, detail) {
  return new Error(
    `The ${name} agent returned an incomplete response (${detail}). Please try again.`
  );
}

export function buildSourceBlock({ code, config, language, fileName }) {
  return [
    `Language / platform: ${language || ".NET"}`,
    `File name: ${fileName || "unknown"}`,
    "",
    "--- SOURCE CODE ---",
    code,
    "",
    "--- CONFIGURATION FILE (optional) ---",
    config && String(config).trim() ? config : "(none provided)",
  ].join("\n");
}

// Runs one agent: a single JSON-only chat completion. Throws a labelled error
// if the model returns something that is not valid JSON. Returns the parsed
// JSON plus the token-usage object reported by the model (when available).
export async function runJsonAgent({ openai, model, name, system, user }) {
  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || "{}";
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`The ${name} agent returned a response that was not valid JSON. Please try again.`);
  }
  return { data, usage: normalizeUsage(completion.usage) };
}

// Normalizes a chat-completion usage object into a stable shape. Returns null
// when the provider did not report usage.
export function normalizeUsage(usage) {
  if (!usage) return null;
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage.total_tokens ?? promptTokens + completionTokens,
  };
}

// Creates an empty telemetry accumulator shared across the pipeline run.
export function createTelemetry() {
  return { stages: [], promptTokens: 0, completionTokens: 0, totalTokens: 0, totalMs: 0 };
}

// Records one agent's token usage and wall-clock time into the accumulator.
export function recordStage(telemetry, stage, usage, ms) {
  if (!telemetry) return;
  const u = usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  telemetry.stages.push({
    stage,
    promptTokens: u.promptTokens,
    completionTokens: u.completionTokens,
    totalTokens: u.totalTokens,
    ms,
  });
  telemetry.promptTokens += u.promptTokens;
  telemetry.completionTokens += u.completionTokens;
  telemetry.totalTokens += u.totalTokens;
}

// Per-1M-token USD pricing for cost estimates. Falls back to gpt-4o-mini rates
// for unknown models/deployments. These are estimates only.
const PRICING = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "o4-mini": { in: 1.1, out: 4.4 },
};

export function estimateCostUsd(model, telemetry) {
  if (!telemetry) return 0;
  const key = String(model || "").toLowerCase();
  const rate =
    Object.keys(PRICING).find((k) => key.includes(k)) || "gpt-4o-mini";
  const { in: inRate, out: outRate } = PRICING[rate];
  return (
    (telemetry.promptTokens / 1e6) * inRate +
    (telemetry.completionTokens / 1e6) * outRate
  );
}
