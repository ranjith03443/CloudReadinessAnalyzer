// Retrieval layer — SCAFFOLDING. Not imported anywhere under agents/.
// Activation point: per-project analysis path, gated on the Settings flag
// `scaling.rag.enabled`. See lib/README.md.
//
// Every implementation satisfies this interface:
//   add(docs)             docs: [{ id?, file?, text, meta? }]
//   query(text, k = 6)    -> Promise<[{ id, file, text, score }]>
//   size()                -> number
//   clear()               -> void

import { chunkSource, splitByFile } from "./chunker.js";

export { chunkSource, splitByFile };

// Default while the layer is inert: indexes nothing, retrieves nothing, so a
// caller that concatenates query() results just gets an empty string.
export class NoopRagIndex {
  add() {}
  async query() {
    return [];
  }
  size() {
    return 0;
  }
  clear() {}
}

// Working PLACEHOLDER: lexical token-overlap scoring — NOT semantic. Enough to
// exercise the end-to-end wiring (chunk -> add -> query -> stitch into a
// prompt) without an embeddings provider. To make it real, replace query()
// with an embeddings call + cosine similarity; nothing else needs to change.
export class InMemoryRagIndex {
  constructor() {
    this.docs = [];
  }
  add(docs = []) {
    for (const d of docs) {
      if (!d || !d.text) continue;
      this.docs.push({
        id: d.id ?? String(this.docs.length),
        file: d.file ?? null,
        text: d.text,
        meta: d.meta ?? {},
        tokens: tokenize(d.text),
      });
    }
  }
  async query(text, k = 6) {
    const q = new Set(tokenize(text));
    if (!q.size) return [];
    return this.docs
      .map((d) => ({ id: d.id, file: d.file, text: d.text, score: overlapScore(q, d.tokens) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
  size() {
    return this.docs.length;
  }
  clear() {
    this.docs = [];
  }
}

function tokenize(s) {
  return String(s).toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) || [];
}

function overlapScore(querySet, docTokens) {
  if (!docTokens.length) return 0;
  const seen = new Set();
  let hits = 0;
  for (const t of docTokens) {
    if (querySet.has(t) && !seen.has(t)) {
      hits++;
      seen.add(t);
    }
  }
  return hits / Math.sqrt(docTokens.length); // length-normalized
}

// Factory the per-project orchestrator would call once activated:
//   const index = createRagIndex(store.getSettings().scaling.rag);
//   index.add(chunkSource(projectCode).map((c, i) => ({ id: i, ...c })));
export function createRagIndex({ enabled = false } = {}) {
  return enabled ? new InMemoryRagIndex() : new NoopRagIndex();
}

// TODO(activate): embeddings-backed index
//   1. providers.js: add createEmbeddingsClient(provider)
//   2. new EmbeddingsRagIndex: add() stores vectors, query() does cosine top-k
//   3. createRagIndex(): pick EmbeddingsRagIndex when a provider is configured
//   4. per-agent: prepend index.query(<agent's focus>) results to the prompt
