// Strategy Planner agent. Recommends a 6R strategy plus a concrete migration
// type (same-language modernization vs. cross-tech rewrite) and target
// architecture — a recommendation for a human to confirm at Gate A, never a
// decision this agent acts on itself. Also exposes a conversational mode
// (discussStrategy) used by Gate A's optional "Discuss with AI" chat: same
// underlying reasoning, but responding to a human's stated constraints.
import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";
import { getPrompt } from "../prompts/loader.js";

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

// System prompts live in prompts/strategist/<active version>.json — see prompts/README.md.
// {{targetLanguages}} / {{architecturePatterns}} are filled from the lists above.
const SYSTEM = getPrompt("strategist", "system", {
  targetLanguages: TARGET_LANGUAGES.join(", "),
});

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

const CHAT_SYSTEM = getPrompt("strategist", "chatSystem", {
  targetLanguages: TARGET_LANGUAGES.join(", "),
  architecturePatterns: ARCHITECTURE_PATTERNS.join(", "),
});

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
