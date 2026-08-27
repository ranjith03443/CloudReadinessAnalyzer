import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";

const SYSTEM = `You are the DETECTION agent in a multi-agent cloud-migration analysis pipeline. You ONLY detect and explain issues — other agents handle code rewriting and scoring. Do NOT rewrite code and do NOT produce a score.

You will receive a legacy .NET (C#) or Java source file and an optional configuration file. Identify migration blockers and tag each as exactly one of these categories: "Deprecated API", "Hardcoded Config", "Cloud Incompatibility".

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

export async function detect({ openai, model, code, config, language, fileName }) {
  const user = buildSourceBlock({ code, config, language, fileName });
  const { data: result, usage } = await runJsonAgent({ openai, model, name: "Detection", system: SYSTEM, user });
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
