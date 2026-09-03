# `lib/` — scaling layers (scaffolded, not wired in)

Two capabilities that a portfolio-scale version of this tool needs, built as
real modules with working stub implementations but **deliberately not
connected to the pipeline**. They exist so the design is on record and the
integration point is unambiguous — not because they do anything yet.

Their on/off flags live in **Settings → Scaling & performance** (architect
role) and in `store.getSettings().scaling`. While `status` is `"scaffolded"`,
toggling a flag persists and is audited but changes no pipeline behavior.

| Layer | Module | Default impl | Working impl (also here) |
|---|---|---|---|
| RAG (retrieval) | [rag/index.js](rag/index.js) | `NoopRagIndex` — indexes/returns nothing | `InMemoryRagIndex` — lexical token-overlap, **not** semantic |
| Agent cache | [cache/index.js](cache/index.js) | `NoopCache` — every lookup misses | `InMemoryCache` — LRU + per-entry TTL, content-hash keys |

Nothing under `agents/` imports either module. `lib/scaling.js` is imported
only by the store (to shape the settings object) and `server.js` (the
`/api/settings/scaling` routes and the startup banner).

---

## RAG — retrieval instead of one 2 MB blob

**Why it's not active.** Ingestion caps input at 200 files / 2 MB
([ingest.js](../ingest.js)) and every agent gets the whole combined-source
blob in one prompt. Retrieval only earns its complexity once a *single
project* is too big to fit — a portfolio concern, not a today concern.

**What's here.**

- `chunker.js` — `splitByFile()` / `chunkSource()`: deterministic, no LLM.
  Splits on the same `// ===== path =====` markers the rest of the app uses,
  then by size with a small overlap.
- `index.js` — the `RagIndex` interface, `NoopRagIndex`, and a functional
  `InMemoryRagIndex` whose `query()` is keyword overlap so the wiring can be
  exercised without an embeddings API.

**To activate.**

1. `providers.js`: add `createEmbeddingsClient(provider)`.
2. `lib/rag/index.js`: add `EmbeddingsRagIndex` — `add()` stores vectors,
   `query()` does cosine top-k; have `createRagIndex()` pick it when a
   provider is configured and `scaling.rag.enabled` is true.
3. In the (future) per-project orchestrator: build one index per project from
   `chunkSource(projectCode)`, then for each agent prepend
   `index.query(<that agent's focus>)` to its user message instead of the
   full source.

---

## Agent cache — skip repeat calls

**Why it's not active.** Not wired into `runJsonAgent`, and it needs a
persistence decision (in-memory is fine for one process; SQLite or Redis for
multiple workers) plus invalidation rules for re-assessments.

**What's here.**

- `key.js` — `contentHash()` and `agentCacheKey({ agent, provider, model,
  system, user, schema })`. Any change to prompt text, model, provider, or
  schema yields a new key; that *is* the invalidation.
- `index.js` — the cache interface, `NoopCache`, and a functional
  `InMemoryCache` (LRU + TTL). `getOrCompute(key, fn)` is the one call site
  needs.

**To activate.**

1. `agents/shared.js`: near the top of `runJsonAgent()`, build
   `const cache = createAgentCache(getSettings().scaling.cache)` (or pass one
   in via the graph config), then wrap the provider call:

   ```js
   const key = agentCacheKey({ agent: name, provider, model, system, user, schema });
   return cache.getOrCompute(key, () => /* existing provider call */);
   ```

2. Optionally add Anthropic prompt caching in the same file: mark the system
   prompt and the source block with `cache_control: { type: "ephemeral" }` so
   the five agents in one run share a cached prefix.
3. Surface `cache.stats()` on the telemetry object for the cost panel.
