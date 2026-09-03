// Deterministic source chunker — no LLM, no dependencies. Splits the
// combined-source blob (the "// ===== path =====" convention produced by
// ingest.js and the browser's multi-file picker) into per-file, then
// size-bounded, chunks ready to be indexed. SCAFFOLDING — not yet used.

const FILE_HEADER = /^\/\/ =====\s*(.+?)\s*=====\s*$/gm;

// [{ file, text }] — one entry per "// ===== file =====" section, or a single
// unnamed entry if there are no headers.
export function splitByFile(code) {
  const src = String(code || "");
  const matches = [...src.matchAll(FILE_HEADER)];
  if (!matches.length) return [{ file: null, text: src.trim() }];
  const out = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : src.length;
    out.push({ file: matches[i][1], text: src.slice(start, end).trim() });
  }
  return out;
}

// [{ file, index, text }] — per-file, then sliced to maxChars with a small
// overlap so a construct split across a boundary still appears whole in one
// chunk.
export function chunkSource(code, { maxChars = 4000, overlapChars = 200 } = {}) {
  const chunks = [];
  // Overlap can never eat more than half a window, so a chunk always advances.
  const overlap = Math.max(0, Math.min(overlapChars, Math.floor(maxChars / 2)));
  for (const { file, text } of splitByFile(code)) {
    if (!text) continue;
    if (text.length <= maxChars) {
      chunks.push({ file, index: 0, text });
      continue;
    }
    const step = maxChars - overlap;
    let i = 0;
    let part = 0;
    while (i < text.length) {
      chunks.push({ file, index: part++, text: text.slice(i, i + maxChars) });
      i += step;
    }
  }
  return chunks;
}
