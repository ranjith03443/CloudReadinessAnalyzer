// Validation agent. Runs deterministic static sanity checks over the
// modernized code first (real checks, not an LLM guess), then asks the LLM
// only to judge whether each ORIGINAL finding is plausibly resolved by the
// rewrite. For cross-tech runs, structural parity (rough method/function
// count vs. the original) is checked too, and manual review is always
// recommended — a full language translation can't be verified deterministically.
import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";

function bracesBalanced(code) {
  let depth = 0;
  for (const ch of code) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

const SECRET_PATTERNS = [
  /password\s*=\s*["'][^"']{3,}["']/i,
  /pwd\s*=\s*["'][^"']{3,}["']/i,
  /api[_-]?key\s*=\s*["'][^"']{6,}["']/i,
  /secret\s*=\s*["'][^"']{6,}["']/i,
  /sk_live_[a-zA-Z0-9]{10,}/,
  /Server=.+;.*Password=/i,
];

function hasLeftoverSecrets(code) {
  return SECRET_PATTERNS.some((p) => p.test(code));
}

// Very rough, language-agnostic count of function/method declarations, used
// only as a structural-parity signal (not a real parser).
const DECLARATION_PATTERNS = [
  /\b(?:public|private|protected|internal)\b[^\n;{}]*\([^)]*\)\s*\{/g,
  /\bdef\s+\w+\s*\(/g,
  /\bfunction\s+\w+\s*\(/g,
  /\b(?:Sub|Function)\s+\w+\s*\(/gi,
];

function countDeclarations(code) {
  let count = 0;
  for (const pattern of DECLARATION_PATTERNS) {
    const matches = code.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

// Deterministic — no LLM involved. Exported so it can be exercised
// independently of the AI synthesis step below.
export function runStaticChecks({ originalCode, modernizedCode, migrationType }) {
  const checks = [
    { check: "Braces/blocks balanced", passed: bracesBalanced(modernizedCode) },
    { check: "No leftover hardcoded secrets", passed: !hasLeftoverSecrets(modernizedCode) },
    { check: "No leftover TODO/FIXME markers", passed: !/\b(TODO|FIXME)\b/.test(modernizedCode) },
  ];

  let structuralParity = null;
  if (migrationType === "cross-tech") {
    const originalDeclarationCount = countDeclarations(originalCode);
    const modernizedDeclarationCount = countDeclarations(modernizedCode);
    const ratio =
      originalDeclarationCount > 0
        ? modernizedDeclarationCount / originalDeclarationCount
        : modernizedDeclarationCount > 0
          ? Infinity
          : 1;
    const withinExpectedRange = ratio >= 0.5 && ratio <= 2;
    structuralParity = { originalDeclarationCount, modernizedDeclarationCount, withinExpectedRange };
    checks.push({ check: "Method/function count within expected range of the original", passed: withinExpectedRange });
  }

  return { checks, structuralParity };
}

const SYSTEM = `You are the VALIDATION agent in a multi-agent cloud-migration pipeline. Code Intelligence and Transformation agents have already run (their findings and the modernized code are provided to you, along with deterministic static-check results). Your job is ONLY to assess whether the modernized code plausibly resolves the ORIGINAL findings. Do NOT rewrite code and do NOT invent new findings.

Return ONLY a JSON object with this exact shape:
{
  "findingResolutions": [ { "findingId": string, "resolved": boolean, "note": string } ],
  "manualReviewRecommended": boolean,
  "summary": string
}

Rules:
- "findingResolutions" must contain exactly one entry per supplied finding, using the same "findingId" values, judging whether the modernized code plausibly resolves each one.
- "manualReviewRecommended" should be true if any high-severity finding was not resolved, or if you have material doubts about the rewrite — independent of the deterministic static checks, which are already factored in separately.
- "summary" is 2-4 sentences: overall confidence in the modernization, and what a human reviewer should focus on.
- Return valid JSON only, no markdown.`;

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    findingResolutions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          findingId: { type: "string" },
          resolved: { type: "boolean" },
          note: { type: "string" },
        },
        required: ["findingId", "resolved"],
      },
    },
    manualReviewRecommended: { type: "boolean" },
    summary: { type: "string" },
  },
  required: ["findingResolutions", "manualReviewRecommended", "summary"],
};

export async function validate({
  openai,
  provider,
  model,
  code,
  config,
  language,
  fileName,
  findings,
  modernizedCode,
  migrationType = "same-language",
  targetLanguage = null,
}) {
  const { checks, structuralParity } = runStaticChecks({ originalCode: code, modernizedCode, migrationType });

  const user =
    buildSourceBlock({ code, config, language, fileName }) +
    `\n\nMigration type: ${migrationType}${targetLanguage ? ` (target language: ${targetLanguage})` : ""}` +
    "\n\n--- ORIGINAL FINDINGS (Code Intelligence agent) ---\n" +
    JSON.stringify(findings || [], null, 2) +
    "\n\n--- MODERNIZED CODE ---\n" +
    modernizedCode +
    "\n\n--- DETERMINISTIC STATIC CHECKS (already run; do not re-derive) ---\n" +
    JSON.stringify(checks, null, 2);

  const { data: result, usage } = await runJsonAgent({ openai, provider, model, name: "Validation", system: SYSTEM, user, schema: RESULT_SCHEMA });

  if (!Array.isArray(result.findingResolutions)) {
    throw agentError("Validation", "missing or invalid 'findingResolutions' array");
  }

  // Manual review is forced (not just suggested) for cross-tech runs — a full
  // language translation cannot be verified deterministically — and whenever
  // any static check failed.
  const forcedManualReview = migrationType === "cross-tech" || checks.some((c) => !c.passed);

  return {
    findingResolutions: result.findingResolutions,
    staticChecks: checks,
    structuralParity,
    manualReviewRecommended: Boolean(result.manualReviewRecommended) || forcedManualReview,
    validationSummary: typeof result.summary === "string" ? result.summary : "",
    usage,
  };
}
