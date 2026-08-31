import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { modernize } from "./modernizer.js";
import { validate } from "./validator.js";
import { createTelemetry, recordStage } from "./shared.js";

// Phase 2 of the two-phase pipeline: Transformation, then Validation. Only
// ever invoked after Gate A confirms proceeding — findings, migration type,
// and target language/cloud all come from the confirmed Gate A decision, not
// re-derived here.
const TransformState = Annotation.Root({
  // Inputs
  code: Annotation,
  config: Annotation,
  language: Annotation,
  fileName: Annotation,
  findings: Annotation,
  migrationType: Annotation,
  targetLanguage: Annotation,
  targetCloud: Annotation,
  targetArchitecturePattern: Annotation,

  // Transformation outputs
  modernizedCode: Annotation,
  cloudReadyConfig: Annotation,
  translationAssumptions: Annotation,

  // Validation outputs
  findingResolutions: Annotation,
  staticChecks: Annotation,
  structuralParity: Annotation,
  manualReviewRecommended: Annotation,
  validationSummary: Annotation,
});

async function modernizeNode(state, runConfig) {
  const { openai, provider, model, onEvent, telemetry } = runConfig.configurable;
  onEvent({ type: "stage", stage: "modernize", status: "start" });
  const t0 = Date.now();
  const { modernizedCode, cloudReadyConfig, translationAssumptions, usage } = await modernize({
    openai,
    provider,
    model,
    ...state,
  });
  const ms = Date.now() - t0;
  recordStage(telemetry, "modernize", usage, ms);
  onEvent({ type: "stage", stage: "modernize", status: "done", usage, ms });
  return { modernizedCode, cloudReadyConfig, translationAssumptions };
}

async function validateNode(state, runConfig) {
  const { openai, provider, model, onEvent, telemetry } = runConfig.configurable;
  onEvent({ type: "stage", stage: "validate", status: "start" });
  const t0 = Date.now();
  const { findingResolutions, staticChecks, structuralParity, manualReviewRecommended, validationSummary, usage } =
    await validate({ openai, provider, model, ...state });
  const ms = Date.now() - t0;
  recordStage(telemetry, "validate", usage, ms);
  onEvent({ type: "stage", stage: "validate", status: "done", usage, ms });
  return { findingResolutions, staticChecks, structuralParity, manualReviewRecommended, validationSummary };
}

const graph = new StateGraph(TransformState)
  .addNode("modernize", modernizeNode)
  .addNode("validate", validateNode)
  .addEdge(START, "modernize")
  .addEdge("modernize", "validate")
  .addEdge("validate", END)
  .compile();

export async function runTransformPipeline(ctx, onEvent = () => {}) {
  const {
    openai,
    provider,
    model,
    code,
    config,
    language,
    fileName,
    findings,
    migrationType,
    targetLanguage,
    targetCloud,
    targetArchitecturePattern,
  } = ctx;
  const telemetry = createTelemetry();
  const start = Date.now();
  const finalState = await graph.invoke(
    { code, config, language, fileName, findings, migrationType, targetLanguage, targetCloud, targetArchitecturePattern },
    { configurable: { openai, provider, model, onEvent, telemetry } }
  );
  telemetry.totalMs = Date.now() - start;

  return {
    modernizedCode: finalState.modernizedCode,
    cloudReadyConfig: finalState.cloudReadyConfig,
    translationAssumptions: finalState.translationAssumptions,
    findingResolutions: finalState.findingResolutions,
    staticChecks: finalState.staticChecks,
    structuralParity: finalState.structuralParity,
    manualReviewRecommended: finalState.manualReviewRecommended,
    validationSummary: finalState.validationSummary,
    telemetry,
  };
}
