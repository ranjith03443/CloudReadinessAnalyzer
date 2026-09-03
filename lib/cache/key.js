// Content-hash key helpers for the agent response cache. Pure, deterministic,
// no dependencies. Safe to use the moment the cache layer is activated.

import { createHash } from "node:crypto";

// sha256 over an ordered list of parts (strings hashed as-is, everything else
// JSON-stringified). Stable across processes.
export function contentHash(...parts) {
  const h = createHash("sha256");
  for (const p of parts) {
    h.update(typeof p === "string" ? p : JSON.stringify(p ?? null));
    h.update(" "); // separator so ["a","b"] does not collide with ["ab"]
  }
  return h.digest("hex");
}

// The cache key for one agent call. Any change to the prompt text, the model,
// the provider, or the expected schema produces a different key, which is
// exactly the invalidation behavior we want.
export function agentCacheKey({ agent, provider, model, system, user, schema }) {
  return contentHash("agent-cache/v1", agent, provider, model, system, user, schema || null);
}
