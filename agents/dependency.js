// Dependency Analysis agent. Unlike every other agent, this one starts from a
// deterministic, regex-based static scan of the ingested source (real parsing
// of using/import/require-style statements and the namespaces/classes
// declared across the submitted files) — the LLM call only synthesizes risk
// commentary over what that scan actually found, it never invents references.
import { runJsonAgent, buildSourceBlock, agentError } from "./shared.js";
import { getPrompt } from "../prompts/loader.js";

// One or more patterns per language that pull the referenced module/namespace
// out of an import-style statement. Deliberately simple/line-oriented — this
// is a best-effort scan across whatever files were ingested, not a compiler.
const IMPORT_PATTERNS = {
  ".NET": [/^\s*using\s+([\w.]+)\s*;/gm],
  Java: [/^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm],
  "VB6 / VB.NET": [/^\s*Imports\s+([\w.]+)/gim],
  COBOL: [/^\s*COPY\s+([\w-]+)/gim],
  PHP: [
    /^\s*use\s+([\w\\]+)/gim,
    /(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/gim,
  ],
  Python: [/^\s*import\s+([\w.]+)/gm, /^\s*from\s+([\w.]+)\s+import/gm],
};

const DECLARATION_PATTERNS = [
  /^\s*namespace\s+([\w.]+)/gm,
  /^\s*package\s+([\w.]+)\s*;/gm,
  /^\s*(?:public\s+|private\s+|internal\s+|protected\s+)?(?:sealed\s+|abstract\s+|static\s+|final\s+)?class\s+(\w+)/gm,
  /^\s*(?:public\s+)?interface\s+(\w+)/gm,
];

const FILE_HEADER = /^\/\/ =====\s*(.+?)\s*=====\s*$/gm;

// Splits the combined source back into per-file chunks using the same
// "// ===== filename =====" markers ingestion/upload already produce. Falls
// back to treating the whole blob as one unnamed file.
function splitFiles(code) {
  const matches = [...code.matchAll(FILE_HEADER)];
  if (!matches.length) return [{ file: null, text: code }];
  const files = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : code.length;
    files.push({ file: matches[i][1], text: code.slice(start, end) });
  }
  return files;
}

// Symbols (namespaces/packages/class names) declared anywhere in the
// submitted files — used to decide whether a reference resolves internally.
function declaredSymbols(files) {
  const symbols = new Set();
  for (const { text } of files) {
    for (const pattern of DECLARATION_PATTERNS) {
      for (const m of text.matchAll(pattern)) symbols.add(m[1]);
    }
  }
  return symbols;
}

// Deterministic extraction — no LLM involved. Exported so it can be tested
// and reasoned about independently of the AI synthesis step below.
export function extractReferences(code, language) {
  const files = splitFiles(code);
  const patterns = IMPORT_PATTERNS[language] || IMPORT_PATTERNS[".NET"];
  const declared = declaredSymbols(files);
  const seen = new Set();
  const references = [];

  for (const { file, text } of files) {
    for (const pattern of patterns) {
      for (const m of text.matchAll(pattern)) {
        const raw = (m[1] || "").trim();
        if (!raw) continue;
        const key = `${file || "?"}::${raw}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const shortName = raw.split(/[.\\/]/).pop();
        const internal = declared.has(raw) || declared.has(shortName);
        references.push({
          file: file || "(submitted code)",
          reference: raw,
          category: internal ? "internal" : "external",
        });
      }
    }
  }

  return {
    references,
    externalCount: references.filter((r) => r.category === "external").length,
    internalCount: references.filter((r) => r.category === "internal").length,
  };
}

// System prompt lives in prompts/dependency/<active version>.json — see prompts/README.md.
const SYSTEM = getPrompt("dependency", "system");

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    dependencies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          reference: { type: "string" },
          category: { type: "string", enum: ["internal", "external"] },
          risk: { type: "string", enum: ["None", "Low", "Medium", "High"] },
          note: { type: "string" },
        },
        required: ["reference", "category", "risk"],
      },
    },
  },
  required: ["dependencies"],
};

export async function analyzeDependencies({ openai, provider, model, code, config, language, fileName }) {
  const extracted = extractReferences(code, language);

  if (!extracted.references.length) {
    return {
      summary: "No import/using-style statements were found in the submitted code.",
      dependencies: [],
      externalCount: 0,
      internalCount: 0,
      usage: null,
    };
  }

  const user =
    buildSourceBlock({ code, config, language, fileName }) +
    "\n\n--- STATICALLY EXTRACTED REFERENCES (deterministic scan; do not add or remove entries) ---\n" +
    JSON.stringify(extracted.references, null, 2);

  const { data: result, usage } = await runJsonAgent({
    openai,
    provider,
    model,
    name: "Dependency Analysis",
    system: SYSTEM,
    user,
    schema: RESULT_SCHEMA,
  });

  if (!Array.isArray(result.dependencies)) {
    throw agentError("Dependency Analysis", "missing or invalid 'dependencies' array");
  }

  return {
    summary: typeof result.summary === "string" ? result.summary : "",
    dependencies: result.dependencies,
    externalCount: extracted.externalCount,
    internalCount: extracted.internalCount,
    usage,
  };
}
