import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { detect } from "./detector.js";
import { modernize } from "./modernizer.js";
import { score } from "./scorer.js";
import { createTelemetry, recordStage } from "./shared.js";

// The multi-agent pipeline is modelled as a LangGraph StateGraph:
//
//            ┌─────────────┐
//   START ──▶│   detect    │
//            └──────┬──────┘
//             fan-out (parallel superstep)
//            ┌──────┴───────┐
//      ┌─────▼─────┐  ┌─────▼─────┐
//      │ modernize │  │   score   │
//      └─────┬─────┘  └─────┬─────┘
//            └──────┬───────┘
//                  END
//
// Detection runs first; modernization and scoring then run in parallel in the
// same superstep, both reading the findings produced by detection. Each node
// emits stage events through the `onEvent` callback (passed via the run config)
// so the server can stream pipeline progress to the UI.

const PipelineState = Annotation.Root({
  // Inputs
  code: Annotation,
  config: Annotation,
  language: Annotation,
  fileName: Annotation,
  // Detection outputs
  summary: Annotation,
  findings: Annotation,
  // Modernization outputs
  modernizedCode: Annotation,
  cloudReadyConfig: Annotation,
  // Scoring outputs
  cloudReadinessScore: Annotation,
  scoreRationale: Annotation,
  scoreBreakdown: Annotation,
  riskSummary: Annotation,
  migrationEstimate: Annotation,
});

async function detectNode(state, runConfig) {
  const { openai, model, onEvent, telemetry } = runConfig.configurable;
  onEvent({ type: "stage", stage: "detect", status: "start" });
  const t0 = Date.now();
  const { summary, findings, usage } = await detect({ openai, model, ...state });
  const ms = Date.now() - t0;
  recordStage(telemetry, "detect", usage, ms);
  onEvent({ type: "stage", stage: "detect", status: "done", count: findings.length, usage, ms });
  return { summary, findings };
}

async function modernizeNode(state, runConfig) {
  const { openai, model, onEvent, telemetry } = runConfig.configurable;
  onEvent({ type: "stage", stage: "modernize", status: "start" });
  const t0 = Date.now();
  const { modernizedCode, cloudReadyConfig, usage } = await modernize({ openai, model, ...state });
  const ms = Date.now() - t0;
  recordStage(telemetry, "modernize", usage, ms);
  onEvent({ type: "stage", stage: "modernize", status: "done", usage, ms });
  return { modernizedCode, cloudReadyConfig };
}

async function scoreNode(state, runConfig) {
  const { openai, model, onEvent, telemetry } = runConfig.configurable;
  onEvent({ type: "stage", stage: "score", status: "start" });
  const t0 = Date.now();
  const { cloudReadinessScore, scoreRationale, scoreBreakdown, riskSummary, migrationEstimate, usage } =
    await score({
      openai,
      model,
      ...state,
    });
  const ms = Date.now() - t0;
  recordStage(telemetry, "score", usage, ms);
  onEvent({ type: "stage", stage: "score", status: "done", usage, ms });
  return { cloudReadinessScore, scoreRationale, scoreBreakdown, riskSummary, migrationEstimate };
}

const graph = new StateGraph(PipelineState)
  .addNode("detect", detectNode)
  .addNode("modernize", modernizeNode)
  .addNode("score", scoreNode)
  .addEdge(START, "detect")
  .addEdge("detect", "modernize")
  .addEdge("detect", "score")
  .addEdge("modernize", END)
  .addEdge("score", END)
  .compile();

// Runs the LangGraph pipeline. `ctx` carries the OpenAI client, model, and the
// source inputs. `onEvent` receives streaming stage events. Returns the merged
// detection + modernization + scoring result (same shape the UI's render()
// expects). If any agent node throws, graph.invoke rejects and the error
// propagates to the caller.
export async function runPipeline(ctx, onEvent = () => {}) {
  const { openai, model, code, config, language, fileName } = ctx;
  const telemetry = createTelemetry();
  const start = Date.now();
  const finalState = await graph.invoke(
    { code, config, language, fileName },
    { configurable: { openai, model, onEvent, telemetry } }
  );
  telemetry.totalMs = Date.now() - start;

  return {
    summary: finalState.summary,
    findings: finalState.findings,
    modernizedCode: finalState.modernizedCode,
    cloudReadyConfig: finalState.cloudReadyConfig,
    cloudReadinessScore: finalState.cloudReadinessScore,
    scoreRationale: finalState.scoreRationale,
    scoreBreakdown: finalState.scoreBreakdown,
    riskSummary: finalState.riskSummary,
    migrationEstimate: finalState.migrationEstimate,
    telemetry,
  };
}
