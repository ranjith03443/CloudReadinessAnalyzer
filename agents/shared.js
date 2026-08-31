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

// Runs one agent: a single JSON-only completion. Same call site and return
// shape ({ data, usage }) for every agent and every provider — only the
// internals branch on `provider`, since OpenAI/Azure and Claude reach
// structured JSON output through different mechanisms:
//  - openai/azure: `response_format: { type: "json_object" }`, guided by the
//    shape described in `system`'s prose.
//  - claude: a forced tool call (Claude has no json_object mode). Prose
//    alone under-constrains the tool call for anything beyond a flat object
//    (an array that must mirror a supplied input list, in particular), so
//    every call site also passes `schema` — a JSON Schema for the expected
//    result — used as the tool's input_schema. Without it Claude only has
//    the system prompt's prose to go on and can drop or malform fields.
// The `openai` param name is kept (rather than a generic `client`) to avoid
// touching every agent's call site; it holds whichever provider's client.
export async function runJsonAgent({ openai, provider = "openai", model, name, system, user, schema }) {
  if (provider === "claude") {
    return runJsonAgentClaude({ client: openai, model, name, system, user, schema });
  }

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

async function runJsonAgentClaude({ client, model, name, system, user, schema }) {
  const completion = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
    tools: [
      {
        name: "submit_result",
        description: `Submit the ${name} agent's result as JSON matching the shape described in the system prompt.`,
        input_schema: schema || { type: "object" },
      },
    ],
    tool_choice: { type: "tool", name: "submit_result" },
  });

  const toolUse = (completion.content || []).find((block) => block.type === "tool_use");
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
    throw new Error(`The ${name} agent (Claude) did not return a usable result. Please try again.`);
  }

  const usage = completion.usage
    ? {
        promptTokens: completion.usage.input_tokens ?? 0,
        completionTokens: completion.usage.output_tokens ?? 0,
        totalTokens: (completion.usage.input_tokens ?? 0) + (completion.usage.output_tokens ?? 0),
      }
    : null;

  return { data: toolUse.input, usage };
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
