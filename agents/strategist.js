// Strategy Planner agent. Recommends a 6R strategy plus a concrete migration
// type (same-language modernization vs. cross-tech rewrite) and target
// architecture — a recommendation for a human to confirm at Gate A, never a
// decision this agent acts on itself. Also exposes a conversational mode
// (discussStrategy) used by Gate A's optional "Discuss with AI" chat: same
// underlying reasoning, but responding to a human's stated constraints.
import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";

const SIX_R = ["Rehost", "Replatform", "Refactor", "Rebuild", "Retire", "Retain"];
const TARGET_LANGUAGES = [".NET", "Java", "COBOL", "VB6 / VB.NET", "PHP", "Python"];
// "On-premise / portable" is a valid deployment target alongside the clouds —
// it means "vendor-neutral, self-hosted", and its architecture options are
// Containers or Virtual machines (no managed PaaS / Serverless).
const ARCHITECTURE_PATTERNS = ["Containers", "PaaS", "Serverless", "Virtual machines"];

function buildContext({
  code,
  config,
  language,
  fileName,
  findings,
  dependencies,
  targetCloud,
  targetArchitecturePattern,
  preferredMigrationType,
  preferredTargetLanguage,
  plannerNotes,
}) {
  const preferenceLine = preferredMigrationType
    ? `\nHuman's stated migration goal: ${preferredMigrationType === "cross-tech" ? `Cross-Tech Migration (rewrite to ${preferredTargetLanguage || "a different language"})` : "Cloud Readiness (modernize in place, same language)"}`
    : "\nHuman's stated migration goal: (none — let AI decide)";
  const notesBlock =
    plannerNotes && String(plannerNotes).trim()
      ? `\n\n--- NOTES FROM THE HUMAN (guidelines / constraints — honor these unless the code makes them impossible) ---\n${String(plannerNotes).trim()}`
      : "";
  return (
    buildSourceBlock({ code, config, language, fileName }) +
    `\n\nDeployment target: ${targetCloud || "(not specified)"}` +
    `\nTarget Architecture Pattern: ${targetArchitecturePattern || "Let AI recommend"}` +
    preferenceLine +
    notesBlock +
    "\n\n--- ISSUES DETECTED BY THE CODE INTELLIGENCE AGENT ---\n" +
    JSON.stringify(findings || [], null, 2) +
    "\n\n--- DEPENDENCIES FOUND BY THE DEPENDENCY ANALYSIS AGENT ---\n" +
    JSON.stringify(dependencies || [], null, 2)
  );
}

const SYSTEM = `You are the STRATEGY PLANNER agent in a multi-agent cloud-migration assessment pipeline. Code Intelligence and Dependency Analysis agents have already run (their output is provided below). Your job is ONLY to recommend a migration strategy — you do NOT rewrite code, detect issues, or compute a readiness score, and your recommendation is reviewed by a human before anything happens.

Classify the recommended approach using the "6R" model: exactly one of "Rehost", "Replatform", "Refactor", "Rebuild", "Retire", "Retain".

Then recommend a migration TYPE:
- "same-language": modernize the code in place, keeping the same language/platform. Roughly corresponds to Rehost/Replatform. Prefer this by default — it is lower-risk.
- "cross-tech": rewrite the code's logic in a different target language. Roughly corresponds to Refactor/Rebuild. Only recommend this when the code has real blockers a same-language modernization cannot resolve (e.g. deep OS/COM coupling, a dead or unsupported platform, or the stated target genuinely requires a different language).

If you recommend "cross-tech", choose exactly one target language from this list, never the same as the source language: ${TARGET_LANGUAGES.join(", ")}.

The human may have stated a migration goal preference below (or left it as "let AI decide"). If they stated one, generally HONOR it — it is a real input, not decoration. Only recommend something different if the code has a concrete, specific blocker that makes their stated goal clearly wrong (e.g. they want same-language but the code is inseparable from a Windows-only COM API; or they want a cross-tech rewrite but nothing in the findings justifies the added risk over a same-language fix). When you do deviate from their stated goal, say so explicitly and plainly at the start of the justification — do not silently substitute your own preference. If no goal was stated, recommend based on the code alone as normal.

Ground your target architecture recommendation in the supplied Deployment target and Target Architecture Pattern. If you would recommend a different pattern than what was selected, say so explicitly in the justification rather than silently substituting your own choice.

The Deployment target may be a public cloud (Azure / AWS / GCP) OR "On-premise / portable". When it is "On-premise / portable", do NOT name managed cloud services — recommend a vendor-neutral setup instead (self-hosted containers on Kubernetes/Docker or plain VMs, a database you run, config via environment variables plus a secret store such as HashiCorp Vault or Kubernetes Secrets, a reverse proxy / load balancer you operate).

If the human left NOTES above, treat them as real requirements — target language/framework versions, banned technologies, cost or data-residency constraints, priority. Follow them unless a specific finding makes that impossible, and if you cannot, say why in the justification.

Return ONLY a JSON object with this exact shape:
{
  "recommendedStrategy": "Rehost" | "Replatform" | "Refactor" | "Rebuild" | "Retire" | "Retain",
  "migrationType": "same-language" | "cross-tech",
  "targetLanguage": string | null,
  "targetArchitecture": string,
  "justification": string
}

Rules:
- "targetLanguage" is null unless migrationType is "cross-tech".
- "targetArchitecture" is a concrete, short recommendation consistent with the Deployment target / Target Architecture Pattern supplied. For a cloud target, name real services (e.g. "Azure Kubernetes Service (AKS) + Azure SQL + Key Vault", "AWS ECS Fargate + RDS PostgreSQL + Secrets Manager", "GCP Cloud Run + Cloud SQL + Secret Manager"). For an on-premise / portable target, name vendor-neutral infrastructure (e.g. "Kubernetes (containers) + PostgreSQL + HashiCorp Vault + NGINX ingress", "Docker Compose on VMs + PostgreSQL + Vault").
- "justification" is 2-4 sentences grounded in the SPECIFIC findings and dependencies supplied — reference concrete issues, not generic advice.
- Return valid JSON only, no markdown.`;

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    recommendedStrategy: { type: "string", enum: SIX_R },
    migrationType: { type: "string", enum: ["same-language", "cross-tech"] },
    targetLanguage: {},
    targetArchitecture: { type: "string" },
    justification: { type: "string" },
  },
  required: ["recommendedStrategy", "migrationType", "targetArchitecture", "justification"],
};

export async function strategize(ctx) {
  const { openai, provider, model } = ctx;
  const user = buildContext(ctx);
  const { data: result, usage } = await runJsonAgent({
    openai,
    provider,
    model,
    name: "Strategy Planner",
    system: SYSTEM,
    user,
    schema: RESULT_SCHEMA,
  });

  if (!SIX_R.includes(result.recommendedStrategy)) {
    throw agentError("Strategy Planner", "missing or invalid 'recommendedStrategy'");
  }
  const migrationType = result.migrationType === "cross-tech" ? "cross-tech" : "same-language";

  return {
    recommendedStrategy: result.recommendedStrategy,
    migrationType,
    targetLanguage:
      migrationType === "cross-tech" && typeof result.targetLanguage === "string"
        ? result.targetLanguage
        : null,
    targetArchitecture: typeof result.targetArchitecture === "string" ? result.targetArchitecture : "",
    strategyJustification: typeof result.justification === "string" ? result.justification : "",
    usage,
  };
}

// --- Conversational mode: Gate A's optional "Discuss with AI" chat ---------

const CHAT_SYSTEM = `You are the STRATEGY PLANNER agent, continuing a conversation with a human migration lead at Gate A of a cloud-migration assessment. You already produced an initial recommendation (shown below, along with the original findings/dependencies and the conversation so far, if any). The human may state constraints or preferences — e.g. "we're an AWS shop", "the team doesn't know COBOL, avoid a full rewrite", "budget is tight". Respond conversationally and grounded in the ACTUAL findings/dependencies supplied: say plainly what's feasible and what isn't, and why, rather than generic advice. You may revise your recommendation in light of what they said, or hold your ground and explain why if their request conflicts with what the code actually needs.

Return ONLY a JSON object with this exact shape:
{
  "reply": string,
  "suggestedMigrationType": "same-language" | "cross-tech",
  "suggestedTargetLanguage": string | null,
  "suggestedTargetArchitecturePattern": "Containers" | "PaaS" | "Serverless" | "Virtual machines" | null
}

Rules:
- "reply" is a natural conversational response (2-5 sentences), plain text — never JSON or markdown inside it.
- "suggestedTargetLanguage" is null unless suggestedMigrationType is "cross-tech"; when set it must be one of: ${TARGET_LANGUAGES.join(", ")}.
- "suggestedTargetArchitecturePattern" is one of ${ARCHITECTURE_PATTERNS.join(", ")}, or null if you have no new suggestion for it (i.e. you agree with what was already selected).
- Never fabricate findings or dependencies that were not supplied.
- Return valid JSON only, no markdown.`;

const CHAT_RESULT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    suggestedMigrationType: { type: "string", enum: ["same-language", "cross-tech"] },
    suggestedTargetLanguage: {},
    suggestedTargetArchitecturePattern: {},
  },
  required: ["reply", "suggestedMigrationType"],
};

export async function discussStrategy({
  openai,
  provider,
  model,
  code,
  config,
  language,
  fileName,
  findings,
  dependencies,
  targetCloud,
  targetArchitecturePattern,
  plannerNotes,
  initialRecommendation,
  conversation,
  userMessage,
}) {
  const context =
    buildContext({ code, config, language, fileName, findings, dependencies, targetCloud, targetArchitecturePattern, plannerNotes }) +
    "\n\n--- YOUR INITIAL RECOMMENDATION ---\n" +
    JSON.stringify(initialRecommendation || {}, null, 2) +
    "\n\n--- CONVERSATION SO FAR ---\n" +
    JSON.stringify(conversation || [], null, 2) +
    "\n\n--- HUMAN'S NEW MESSAGE ---\n" +
    userMessage;

  const { data: result, usage } = await runJsonAgent({
    openai,
    provider,
    model,
    name: "Strategy Planner (chat)",
    system: CHAT_SYSTEM,
    user: context,
    schema: CHAT_RESULT_SCHEMA,
  });

  if (typeof result.reply !== "string" || !result.reply.trim()) {
    throw agentError("Strategy Planner (chat)", "missing 'reply'");
  }
  const suggestedMigrationType = result.suggestedMigrationType === "cross-tech" ? "cross-tech" : "same-language";

  return {
    reply: result.reply,
    suggestedMigrationType,
    suggestedTargetLanguage:
      suggestedMigrationType === "cross-tech" && typeof result.suggestedTargetLanguage === "string"
        ? result.suggestedTargetLanguage
        : null,
    suggestedTargetArchitecturePattern: ARCHITECTURE_PATTERNS.includes(result.suggestedTargetArchitecturePattern)
      ? result.suggestedTargetArchitecturePattern
      : null,
    usage,
  };
}
