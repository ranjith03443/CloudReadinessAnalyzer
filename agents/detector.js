import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";

const SYSTEM = `You are the CODE INTELLIGENCE agent in a multi-agent cloud-migration analysis pipeline. You ONLY detect and explain issues — other agents handle dependency analysis, strategy, code rewriting and scoring. Do NOT rewrite code and do NOT produce a score.

You will receive a legacy source file (in the language/platform stated below — e.g. .NET, Java, COBOL, VB6/VB.NET, PHP, or Python) and an optional configuration file. Identify migration blockers and tag each as exactly one of these categories: "Deprecated API", "Hardcoded Config", "Cloud Incompatibility".

Return ONLY a JSON object with this exact shape:
{
  "summary": { "fileName": string, "language": string, "overview": string },
  "findings": [
    {
      "id": string,
      "category": "Deprecated API" | "Hardcoded Config" | "Cloud Incompatibility",
      "severity": "High" | "Medium" | "Low",
      "title": string,
      "location": string,
      "explanation": string,
      "recommendation": string
    }
  ]
}

Rules:
- Base EVERY finding strictly on the supplied input. Do NOT invent issues. If the code is already clean, return an empty "findings" array.
- "location" is a line number or a short quoted snippet from the input, or "n/a".
- "overview" is a 2-3 sentence plain-English assessment of the file.
- Detect: deprecated/unsupported APIs; hardcoded configuration (connection strings, secrets, file paths, machine names, absolute URLs); and cloud incompatibilities (local file system, in-process session, machine-bound state, missing config externalization, etc.).
- Return valid JSON only, no markdown.`;

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
