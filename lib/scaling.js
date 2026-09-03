// Single source of truth for the two "scaling" architecture layers that are
// SCAFFOLDED but deliberately NOT wired into the pipeline yet:
//
//   - rag   : retrieval over large codebases instead of one 2 MB blob
//   - cache : skip repeat agent calls (content-hash) + provider prompt caching
//
// The modules live in lib/rag/ and lib/cache/. Nothing under agents/ imports
// them. This file is imported only by the store (to shape the settings object)
// and server.js (to expose /api/settings/scaling and the startup banner).
//
// See lib/README.md for the rationale and the exact activation steps.

export const SCALING_LAYERS = {
  rag: {
    id: "rag",
    label: "Retrieval-Augmented Generation (RAG)",
    status: "scaffolded", // "scaffolded" | "active"
    module: "lib/rag/index.js",
    summary:
      "Chunk and index a large codebase, then retrieve only the slices relevant to each agent instead of sending the whole combined-source blob.",
    whyNotYet:
      "Inputs are capped at 200 files / 2 MB (ingest.js) and fit in one prompt. RAG only pays off once an individual project exceeds the context window.",
    activationPoint:
      "agents/shared.js buildSourceBlock() + a future per-project orchestrator: build an index per project, query it per agent.",
  },
  cache: {
    id: "cache",
    label: "Agent response cache",
    status: "scaffolded",
    module: "lib/cache/index.js",
    summary:
      "Return a stored result when the same (system + source + model + schema) was analyzed before, keyed by content hash. Also the home for provider-side prompt caching.",
    whyNotYet:
      "Not wired into runJsonAgent yet; needs a persistence choice (in-memory / SQLite / Redis) and cache-invalidation rules for re-assessments.",
    activationPoint:
      "agents/shared.js runJsonAgent(): wrap the provider call in cache.getOrCompute(agentCacheKey(...), ...).",
  },
};

// Default flag state — everything off. The flags persist and are audited, but
// while status is "scaffolded" they change no pipeline behavior.
export const SCALING_DEFAULTS = {
  rag: { enabled: false },
  cache: { enabled: false },
};

// Coerces whatever is stored (or posted) into the exact flag shape.
export function normalizeScaling(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    rag: { enabled: Boolean(s.rag && s.rag.enabled) },
    cache: { enabled: Boolean(s.cache && s.cache.enabled) },
  };
}
