import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { detect } from "./detector.js";
import { analyzeDependencies } from "./dependency.js";
import { strategize } from "./strategist.js";
import { score } from "./scorer.js";
import { estimate } from "./estimator.js";
import { createTelemetry, recordStage } from "./shared.js";

// Phase 1 of the two-phase pipeline: assessment only — no code is generated
// here. Modelled as a LangGraph StateGraph with real fan-out AND fan-in, not
// just a longer sequential chain:
//
//            ┌────────┐
//   START ──▶│ detect │──┬────────────────────▶ score ───────────────┐
//        │   └────────┘  │                                           │
//        │                └──────────────┐                           ▼
//        └──▶┌────────────┐              ▼                          END
//            │ dependency │──────────▶ strategize ──▶ estimate ──────▲
//            └────────────┘                                          │
//                                                                    END
//
// detect and dependency both only need the raw source, so they run in
// parallel from START. strategize waits on BOTH detect (findings) and
// dependency (cross-file/external risk) before running. score only needs
// detect. estimate waits on strategize's recommendation, since effort sizing
// depends on which approach was recommended.
const AssessmentState = Annotation.Root({
  // Inputs
  code: Annotation,
  config: Annotation,
  language: Annotation,
  fileName: Annotation,
  targetCloud: Annotation,
  targetArchitecturePattern: Annotation,
  preferredMigrationType: Annotation,
  preferredTargetLanguage: Annotation,
  plannerNotes: Annotation,

  // Code Intelligence outputs
  summary: Annotation,
  findings: Annotation,

  // Dependency Analysis outputs
  dependencySummary: Annotation,
  dependencies: Annotation,
  externalDependencyCount: Annotation,
  internalDependencyCount: Annotation,

  // Strategy Planner outputs
  recommendedStrategy: Annotation,
  migrationType: Annotation,
  targetLanguage: Annotation,
  targetArchitecture: Annotation,
  strategyJustification: Annotation,

  // Scoring outputs
  cloudReadinessScore: Annotation,
  scoreRationale: Annotation,
  scoreBreakdown: Annotation,
  riskSummary: Annotation,

  // Estimation outputs
  migrationEstimate: Annotation,
});

async function detectNode(state, runConfig) {
  const { openai, provider, model, onEvent, telemetry } = runConfig.configurable;
  onEvent({ type: "stage", stage: "detect", status: "start" });
  const t0 = Date.now();
  const { summary, findings, usage } = await detect({ openai, provider, model, ...state });
  const ms = Date.now() - t0;
  recordStage(telemetry, "detect", usage, ms);
  onEvent({ type: "stage", stage: "detect", status: "done", count: findings.length, usage, ms });
  return { summary, findings };
}

async function dependencyNode(state, runConfig) {
  const { openai, provider, model, onEvent, telemetry } = runConfig.configurable;
  onEvent({ type: "stage", stage: "dependency", status: "start" });
  const t0 = Date.now();
  const { summary, dependencies, externalCount, internalCount, usage } = await analyzeDependencies({
    openai,
    provider,
    model,
    ...state,
  });
  const ms = Date.now() - t0;
  recordStage(telemetry, "dependency", usage, ms);
  onEvent({ type: "stage", stage: "dependency", status: "done", count: dependencies.length, usage, ms });
  return {
    dependencySummary: summary,
    dependencies,
    externalDependencyCount: externalCount,
    internalDependencyCount: internalCount,
  };
}

async function strategizeNode(state, runConfig) {
  const { openai, provider, model, onEvent, telemetry } = runConfig.configurable;
  onEvent({ type: "stage", stage: "strategize", status: "start" });
  const t0 = Date.now();
  const {
    recommendedStrategy,
    migrationType,
    targetLanguage,
    targetArchitecture,
    strategyJustification,
    usage,
  } = await strategize({ openai, provider, model, ...state });
  const ms = Date.now() - t0;
  recordStage(telemetry, "strategize", usage, ms);
  onEvent({ type: "stage", stage: "strategize", status: "done", usage, ms });
  return { recommendedStrategy, migrationType, targetLanguage, targetArchitecture, strategyJustification };
}

async function scoreNode(state, runConfig) {
  const { openai, provider, model, onEvent, telemetry } = runConfig.configurable;
  onEvent({ type: "stage", stage: "score", status: "start" });
  const t0 = Date.now();
  const { cloudReadinessScore, scoreRationale, scoreBreakdown, riskSummary, usage } = await score({
    openai,
    provider,
    model,
    ...state,
  });
  const ms = Date.now() - t0;
  recordStage(telemetry, "score", usage, ms);
  onEvent({ type: "stage", stage: "score", status: "done", usage, ms });
  return { cloudReadinessScore, scoreRationale, scoreBreakdown, riskSummary };
}

async function estimateNode(state, runConfig) {
  const { openai, provider, model, onEvent, telemetry } = runConfig.configurable;
  onEvent({ type: "stage", stage: "estimate", status: "start" });
  const t0 = Date.now();
  const { usage, ...migrationEstimate } = await estimate({ openai, provider, model, ...state });
  const ms = Date.now() - t0;
  recordStage(telemetry, "estimate", usage, ms);
  onEvent({ type: "stage", stage: "estimate", status: "done", usage, ms });
  return { migrationEstimate };
}

const graph = new StateGraph(AssessmentState)
  .addNode("detect", detectNode)
  .addNode("dependency", dependencyNode)
  .addNode("strategize", strategizeNode)
  .addNode("score", scoreNode)
  .addNode("estimate", estimateNode)
  .addEdge(START, "detect")
  .addEdge(START, "dependency")
  .addEdge("detect", "score")
  .addEdge("detect", "strategize")
  .addEdge("dependency", "strategize")
  .addEdge("strategize", "estimate")
  .addEdge("score", END)
  .addEdge("estimate", END)
  .compile();

// Runs the Phase 1 (assessment) graph. `ctx` carries the OpenAI-compatible
// client, model, and source/target inputs. `onEvent` receives streaming stage
// events. Returns the merged assessment result — no code is generated. If any
// agent node throws, graph.invoke rejects and the error propagates to the
// caller.
export async function runAssessmentPipeline(ctx, onEvent = () => {}) {
  const {
    openai,
    provider,
    model,
    code,
    config,
    language,
    fileName,
    targetCloud,
    targetArchitecturePattern,
    preferredMigrationType,
    preferredTargetLanguage,
    plannerNotes,
  } = ctx;
  const telemetry = createTelemetry();
  const start = Date.now();
  const finalState = await graph.invoke(
    { code, config, language, fileName, targetCloud, targetArchitecturePattern, preferredMigrationType, preferredTargetLanguage, plannerNotes },
    { configurable: { openai, provider, model, onEvent, telemetry } }
  );
  telemetry.totalMs = Date.now() - start;

  return {
    summary: finalState.summary,
    findings: finalState.findings,
    dependencySummary: finalState.dependencySummary,
    dependencies: finalState.dependencies,
    externalDependencyCount: finalState.externalDependencyCount,
    internalDependencyCount: finalState.internalDependencyCount,
    recommendedStrategy: finalState.recommendedStrategy,
    migrationType: finalState.migrationType,
    targetLanguage: finalState.targetLanguage,
    targetArchitecture: finalState.targetArchitecture,
    strategyJustification: finalState.strategyJustification,
    cloudReadinessScore: finalState.cloudReadinessScore,
    scoreRationale: finalState.scoreRationale,
    scoreBreakdown: finalState.scoreBreakdown,
    riskSummary: finalState.riskSummary,
    migrationEstimate: finalState.migrationEstimate,
    telemetry,
  };
}
