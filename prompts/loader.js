// Prompt registry. Every agent's system prompt lives in this folder as a
// versioned JSON file (prompts/<agent>/v1.json, v2.json, ...), and a single
// pointer file (prompts/active.json) selects which version each agent loads.
// Bumping a prompt is: copy vN.json -> vN+1.json, edit it, point active.json
// at the new version. Git history is the changelog.
//
// Prompt bodies are stored as an array of lines (joined with "\n" on load) so
// version-to-version diffs stay line-by-line. Templated prompts use {{token}}
// placeholders filled in by the caller via getPrompt(agent, key, vars).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROMPTS_DIR = dirname(fileURLToPath(import.meta.url));

const activeVersions = readJson(join(PROMPTS_DIR, "active.json"), "prompts/active.json");
const cache = new Map();

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Failed to read ${label || file}: ${err.message}`);
  }
}

function loadAgent(agentId) {
  const cached = cache.get(agentId);
  if (cached) return cached;

  const version = activeVersions[agentId];
  if (!version) {
    throw new Error(
      `No active prompt version for agent "${agentId}" — add it to prompts/active.json`
    );
  }

  const doc = readJson(
    join(PROMPTS_DIR, agentId, `${version}.json`),
    `prompts/${agentId}/${version}.json`
  );

  const prompts = {};
  for (const [key, value] of Object.entries(doc.prompts || {})) {
    prompts[key] = Array.isArray(value) ? value.join("\n") : String(value);
  }

  const entry = { id: agentId, version, meta: doc, prompts };
  cache.set(agentId, entry);
  return entry;
}

function render(text, vars) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name) => {
    if (!vars || !(name in vars)) {
      throw new Error(`Prompt placeholder {{${name}}} was not provided a value`);
    }
    return String(vars[name]);
  });
}

// Returns one rendered prompt string for an agent. `key` selects which prompt
// in the file (e.g. "system", "chatSystem"); `vars` fills {{token}} placeholders.
export function getPrompt(agentId, key = "system", vars) {
  const { prompts, version } = loadAgent(agentId);
  const raw = prompts[key];
  if (raw == null) {
    throw new Error(`Prompt "${key}" not found for agent "${agentId}" (version ${version})`);
  }
  return vars ? render(raw, vars) : raw;
}

// { detector: "v1", ... } — the active version of every agent's prompt.
// Used at server startup to log what's loaded.
export function promptVersions() {
  return { ...activeVersions };
}
