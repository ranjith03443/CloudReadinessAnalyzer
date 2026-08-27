const $ = (id) => document.getElementById(id);

const els = {
  language: $("language"),
  codeFile: $("codeFile"),
  codeFolder: $("codeFolder"),
  selectFolderBtn: $("selectFolderBtn"),
  folderInfo: $("folderInfo"),
  code: $("code"),
  configFile: $("configFile"),
  config: $("config"),
  analyzeBtn: $("analyzeBtn"),
  loadSampleBtn: $("loadSampleBtn"),
  inputError: $("inputError"),
  emptyState: $("emptyState"),
  loadingState: $("loadingState"),
  pipeline: $("pipeline"),
  liveTokens: $("liveTokens"),
  liveTokenCount: $("liveTokenCount"),
  results: $("results"),
  modelTag: $("modelTag"),
};

const STAGES = [
  {
    key: "detect",
    label: "Detection agent",
    desc: "Scanning for deprecated APIs, hardcoded config & cloud blockers",
  },
  {
    key: "modernize",
    label: "Modernization agent",
    desc: "Rewriting code & externalizing configuration",
  },
  {
    key: "score",
    label: "Scoring agent",
    desc: "Assessing migration risk & computing readiness score",
  },
];

// The most recent successful analysis + the exact source that produced it.
// Used by the report export and the before/after diff view.
let lastResult = null;
let lastOriginalCode = "";
let liveTokenTotal = 0;

const SEVERITY = {
  High: { text: "text-danger", bg: "bg-danger/15", dot: "bg-danger", border: "border-danger/30" },
  Medium: { text: "text-amber", bg: "bg-amber/15", dot: "bg-amber", border: "border-amber/30" },
  Low: { text: "text-cyan", bg: "bg-cyan/15", dot: "bg-cyan", border: "border-cyan/30" },
};

const RISK = {
  High: { text: "text-danger", ring: "border-danger/40", bg: "bg-danger/10" },
  Medium: { text: "text-amber", ring: "border-amber/40", bg: "bg-amber/10" },
  Low: { text: "text-green", ring: "border-green/40", bg: "bg-green/10" },
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function scoreColor(score) {
  if (score >= 75) return { stroke: "#4ADE80", text: "text-green" };
  if (score >= 45) return { stroke: "#FCD34D", text: "text-amber" };
  return { stroke: "#EF4444", text: "text-danger" };
}

function readFile(input, target) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    target.value = reader.result;
  };
  reader.readAsText(file);
}

function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Extensions treated as analyzable source code. Folder uploads contain lots of
// unrelated files, so we keep only these.
const CODE_EXTENSIONS = [".cs", ".java", ".vb"];

function isCodeFile(file) {
  const name = (file.webkitRelativePath || file.name || "").toLowerCase();
  return CODE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

// Combines one or many code files into the code box. With multiple files, each
// gets a header so the pipeline analyzes the whole folder as a single combined
// readiness score.
async function combineFilesInto(files, target) {
  if (!files.length) return;
  if (files.length === 1) {
    target.value = await readText(files[0]);
    return;
  }
  const parts = await Promise.all(
    files.map(async (f) => {
      const text = await readText(f);
      const name = f.webkitRelativePath || f.name;
      return `// ===== ${name} =====\n${text}`;
    })
  );
  target.value = parts.join("\n\n");
}

// Reads files chosen via the plain file picker (no extension filtering — the
// accept attribute already constrains them).
async function readCodeFiles(input, target) {
  await combineFilesInto(Array.from(input.files || []), target);
}

// Reads a whole folder, keeping only recognized source files, and reports how
// many were found. Returns the count of code files combined.
async function readCodeFolder(input, target) {
  const all = Array.from(input.files || []);
  const codeFiles = all.filter(isCodeFile);
  await combineFilesInto(codeFiles, target);
  return codeFiles.length;
}

// A display name for the submitted code: the single file's name, a combined
// label for a multi-file selection, or "pasted-code" when typed in directly.
function combinedFileName() {
  const folderCodeFiles = Array.from(els.codeFolder.files || []).filter(isCodeFile);
  if (folderCodeFiles.length) {
    const top = (folderCodeFiles[0].webkitRelativePath || "").split("/")[0] || "folder";
    return folderCodeFiles.length > 1
      ? `${top}-${folderCodeFiles.length}-files-combined`
      : folderCodeFiles[0].name;
  }
  const files = Array.from(els.codeFile.files || []);
  if (files.length > 1) return `${files.length}-files-combined`;
  if (files.length === 1) return files[0].name;
  return "pasted-code";
}

els.codeFile.addEventListener("change", () => {
  // A fresh file selection supersedes any previous folder pick.
  els.codeFolder.value = "";
  els.folderInfo.textContent = "";
  readCodeFiles(els.codeFile, els.code).catch(() =>
    showError("Could not read one of the selected files.")
  );
});

els.selectFolderBtn.addEventListener("click", () => els.codeFolder.click());

els.codeFolder.addEventListener("change", async () => {
  // A fresh folder selection supersedes any previous file pick.
  els.codeFile.value = "";
  try {
    const count = await readCodeFolder(els.codeFolder, els.code);
    if (count === 0) {
      els.folderInfo.textContent = "no .cs / .java / .vb files found in that folder";
      els.folderInfo.className = "text-[11px] text-amber";
    } else {
      els.folderInfo.textContent = `${count} code file${count === 1 ? "" : "s"} loaded from folder`;
      els.folderInfo.className = "text-[11px] text-cyan/80";
    }
  } catch {
    showError("Could not read the selected folder.");
  }
});

els.configFile.addEventListener("change", () => readFile(els.configFile, els.config));

els.loadSampleBtn.addEventListener("click", async () => {
  try {
    const isJava = els.language.value === "Java";
    const codePath = isJava ? "samples/LegacyOrderService.java" : "samples/LegacyOrderService.cs";
    const cfgPath = isJava ? "samples/application.properties" : "samples/web.config";
    const [codeRes, cfgRes] = await Promise.all([fetch(codePath), fetch(cfgPath)]);
    if (codeRes.ok) els.code.value = await codeRes.text();
    if (cfgRes.ok) els.config.value = await cfgRes.text();
  } catch {
    showError("Could not load the sample file.");
  }
});

function showError(msg) {
  els.inputError.textContent = msg;
  els.inputError.classList.remove("hidden");
}
function clearError() {
  els.inputError.classList.add("hidden");
}

function setView(view) {
  els.emptyState.classList.toggle("hidden", view !== "empty");
  els.emptyState.classList.toggle("flex", view === "empty");
  els.loadingState.classList.toggle("hidden", view !== "loading");
  els.loadingState.classList.toggle("flex", view === "loading");
  els.results.classList.toggle("hidden", view !== "results");
}

function resetPipeline() {
  els.pipeline.innerHTML = STAGES.map(
    (s) => `
    <div id="stage-${s.key}" class="flex items-start gap-3 rounded-md border border-white/10 bg-navy-deep/40 p-3 opacity-50 transition">
      <div id="stage-icon-${s.key}" class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/20 font-mono text-[10px] text-slate-500">
        ${STAGES.indexOf(s) + 1}
      </div>
      <div class="flex-1">
        <div class="text-sm font-medium text-slate-200">${s.label}</div>
        <div id="stage-desc-${s.key}" class="font-mono text-[11px] leading-snug text-slate-500">${s.desc}</div>
      </div>
    </div>`
  ).join("");
}

function updateStage(evt) {
  const row = document.getElementById(`stage-${evt.stage}`);
  const icon = document.getElementById(`stage-icon-${evt.stage}`);
  const desc = document.getElementById(`stage-desc-${evt.stage}`);
  if (!row || !icon) return;

  if (evt.status === "start") {
    row.classList.remove("opacity-50");
    row.classList.add("border-cyan/40", "bg-cyan/5");
    icon.className =
      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-cyan/40 border-t-cyan animate-spin";
    icon.textContent = "";
  } else if (evt.status === "done") {
    row.classList.remove("opacity-50", "border-cyan/40", "bg-cyan/5");
    row.classList.add("border-green/40", "bg-green/5");
    icon.className =
      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green/20 font-mono text-[11px] text-green";
    icon.textContent = "✓";

    // Build the per-stage status line: detection issue count, plus tokens/time
    // when the server reported usage for this agent.
    const bits = [];
    if (evt.stage === "detect" && typeof evt.count === "number") {
      bits.push(`${evt.count} issue${evt.count === 1 ? "" : "s"} detected`);
    }
    if (evt.usage && typeof evt.usage.totalTokens === "number") {
      const t = evt.usage.totalTokens.toLocaleString();
      bits.push(typeof evt.ms === "number" ? `${t} tokens · ${fmtMs(evt.ms)}` : `${t} tokens`);
    }
    if (desc && bits.length) {
      desc.textContent = bits.join(" · ");
      desc.classList.remove("text-slate-500");
      desc.classList.add("text-green");
    }

    // Update the live running token tally.
    if (evt.usage && typeof evt.usage.totalTokens === "number") {
      liveTokenTotal += evt.usage.totalTokens;
      if (els.liveTokens) els.liveTokens.classList.remove("hidden");
      if (els.liveTokenCount) els.liveTokenCount.textContent = liveTokenTotal.toLocaleString();
    }
  }
}

// Formats a millisecond duration as a compact human string (e.g. "1.1s").
function fmtMs(ms) {
  if (typeof ms !== "number") return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

async function loadHealth() {
  try {
    const res = await fetch("api/health");
    const data = await res.json();
    els.modelTag.textContent = "model: " + (data.model || "unknown");
  } catch {
    els.modelTag.textContent = "model: offline";
  }
}
loadHealth();

els.analyzeBtn.addEventListener("click", () => analyze(false));

async function loadSample() {
  const isJava = els.language.value === "Java";
  const codePath = isJava ? "samples/LegacyOrderService.java" : "samples/LegacyOrderService.cs";
  const cfgPath = isJava ? "samples/application.properties" : "samples/web.config";
  const [codeRes, cfgRes] = await Promise.all([fetch(codePath), fetch(cfgPath)]);
  if (codeRes.ok) els.code.value = await codeRes.text();
  if (cfgRes.ok) els.config.value = await cfgRes.text();
}

async function analyze(demo = false) {
  clearError();

  // In demo mode, auto-load the sample file if the editor is empty so there is
  // always something to show. The demo runs without an API key.
  if (demo && !els.code.value.trim()) {
    try {
      await loadSample();
    } catch {
      showError("Could not load the sample file for the demo.");
      return;
    }
  }

  const code = els.code.value.trim();
  if (!code) {
    showError("Please upload or paste a code file first.");
    return;
  }
  lastOriginalCode = code;

  els.analyzeBtn.disabled = true;
  els.analyzeBtn.textContent = demo ? "Running demo…" : "Analyzing…";
  liveTokenTotal = 0;
  if (els.liveTokens) els.liveTokens.classList.add("hidden");
  if (els.liveTokenCount) els.liveTokenCount.textContent = "0";
  resetPipeline();
  setView("loading");

  try {
    const res = await fetch("api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        config: els.config.value.trim(),
        fileName: combinedFileName(),
        language: els.language.value,
        demo,
      }),
    });

    // Pre-stream errors (missing key, no code) come back as plain JSON.
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showError(data.error || "Analysis failed.");
      setView("empty");
      return;
    }

    // Otherwise consume the NDJSON pipeline stream.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult = null;
    let streamError = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;

        let evt;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }

        if (evt.type === "stage") updateStage(evt);
        else if (evt.type === "result") finalResult = evt.data;
        else if (evt.type === "error") streamError = evt.error;
      }
    }

    if (streamError) {
      showError(streamError);
      setView("empty");
    } else if (finalResult) {
      render(finalResult);
      setView("results");
    } else {
      showError("The pipeline did not return a result. Please try again.");
      setView("empty");
    }
  } catch (err) {
    showError("Could not reach the local server. Is it still running?");
    setView("empty");
  } finally {
    els.analyzeBtn.disabled = false;
    els.analyzeBtn.textContent = "Analyze cloud readiness";
  }
}

function gauge(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - s / 100);
  const { stroke, text } = scoreColor(s);
  return `
    <div class="relative h-36 w-36 shrink-0">
      <svg class="h-36 w-36 -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="10" />
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="${stroke}" stroke-width="10"
          stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${offset}" />
      </svg>
      <div class="absolute inset-0 flex flex-col items-center justify-center">
        <div class="text-3xl font-bold ${text}">${s}</div>
        <div class="font-mono text-[10px] uppercase tracking-widest text-slate-400">/ 100</div>
      </div>
    </div>`;
}

function breakdownBar(item) {
  const s = Math.max(0, Math.min(100, Number(item.score) || 0));
  const { stroke } = scoreColor(s);
  return `
    <div>
      <div class="flex items-center justify-between text-xs">
        <span class="font-medium text-slate-200">${esc(item.layer)}</span>
        <span class="font-mono text-slate-400">${s}</span>
      </div>
      <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div class="h-full rounded-full" style="width:${s}%;background:${stroke}"></div>
      </div>
      ${item.note ? `<p class="mt-1 text-[11px] leading-snug text-slate-500">${esc(item.note)}</p>` : ""}
    </div>`;
}

function findingCard(f) {
  const sev = SEVERITY[f.severity] || SEVERITY.Low;
  return `
    <div class="rounded-lg border ${sev.border} ${sev.bg} p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-2">
          <span class="h-2 w-2 rounded-full ${sev.dot}"></span>
          <h4 class="font-semibold text-slate-100">${esc(f.title)}</h4>
        </div>
        <span class="shrink-0 rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${sev.text} ${sev.bg}">
          ${esc(f.severity)}
        </span>
      </div>
      <div class="mt-1 font-mono text-[11px] text-slate-500">${esc(f.category)}${
        f.location && f.location !== "n/a" ? " · " + esc(f.location) : ""
      }</div>
      <p class="mt-2 text-sm leading-relaxed text-slate-300">${esc(f.explanation)}</p>
      <div class="mt-2 rounded-md border border-white/10 bg-navy-deep/60 p-3">
        <div class="font-mono text-[10px] uppercase tracking-wider text-cyan/70">Recommendation</div>
        <p class="mt-1 text-sm leading-relaxed text-slate-200">${esc(f.recommendation)}</p>
      </div>
    </div>`;
}

function codePanel(title, code, id) {
  return `
    <div class="rounded-lg border border-white/10 bg-navy-panel/50">
      <div class="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <span class="font-mono text-xs uppercase tracking-[0.15em] text-cyan/70">${esc(title)}</span>
        <button data-copy="${id}" class="font-mono text-[11px] uppercase tracking-wider text-slate-400 hover:text-cyan">copy</button>
      </div>
      <pre id="${id}" class="max-h-[420px] overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200">${esc(code)}</pre>
    </div>`;
}

// ── Before/after diff (line-based LCS) ──────────────────────────────────────
function diffLines(aText, bText) {
  const a = String(aText).split("\n");
  const b = String(bText).split("\n");
  const n = a.length;
  const m = b.length;
  // LCS table
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: "ctx", left: a[i], right: b[j] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ type: "del", left: a[i], right: null });
      i++;
    } else {
      rows.push({ type: "add", left: null, right: b[j] });
      j++;
    }
  }
  while (i < n) rows.push({ type: "del", left: a[i++], right: null });
  while (j < m) rows.push({ type: "add", left: null, right: b[j++] });
  return rows;
}

// LCS is O(n*m), so for very large inputs we skip the diff and tell the user to
// use the plain code view instead of freezing the browser.
const DIFF_MAX_LINES = 4000;

function diffPanel(originalCode, modernizedCode) {
  const aLen = String(originalCode).split("\n").length;
  const bLen = String(modernizedCode).split("\n").length;
  if (aLen > DIFF_MAX_LINES || bLen > DIFF_MAX_LINES) {
    return `
      <div class="rounded-lg border border-white/10 bg-navy-panel/50">
        <div class="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
          <span class="font-mono text-xs uppercase tracking-[0.15em] text-cyan/70">Before / after diff</span>
          <button id="diffToggle" class="font-mono text-[11px] uppercase tracking-wider text-slate-400 hover:text-cyan">code view</button>
        </div>
        <p class="p-4 text-sm text-slate-400">
          These files are too large to diff in the browser (over ${DIFF_MAX_LINES} lines).
          Use <span class="text-cyan">code view</span> to read the modernized code.
        </p>
      </div>`;
  }

  const rows = diffLines(originalCode, modernizedCode);
  let added = 0;
  let removed = 0;
  rows.forEach((r) => {
    if (r.type === "add") added++;
    else if (r.type === "del") removed++;
  });

  const side = (rows, pick) =>
    rows
      .map((r) => {
        const line = pick === "left" ? r.left : r.right;
        const isGap =
          (pick === "left" && r.type === "add") || (pick === "right" && r.type === "del");
        let cls = "px-3 text-slate-300";
        if (isGap) cls = "px-3 bg-white/[0.02]";
        else if (r.type === "del" && pick === "left") cls = "px-3 bg-danger/10 text-danger";
        else if (r.type === "add" && pick === "right") cls = "px-3 bg-green/10 text-green";
        return `<div class="${cls}">${isGap ? "&nbsp;" : esc(line) || "&nbsp;"}</div>`;
      })
      .join("");

  return `
    <div class="rounded-lg border border-white/10 bg-navy-panel/50">
      <div class="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div class="flex items-center gap-3">
          <span class="font-mono text-xs uppercase tracking-[0.15em] text-cyan/70">Before / after diff</span>
          <span class="font-mono text-[10px] text-green">+${added}</span>
          <span class="font-mono text-[10px] text-danger">−${removed}</span>
        </div>
        <button id="diffToggle" class="font-mono text-[11px] uppercase tracking-wider text-slate-400 hover:text-cyan">code view</button>
      </div>
      <div class="grid grid-cols-2 gap-px bg-white/10 text-[11px] leading-relaxed">
        <div class="bg-navy-deep/60">
          <div class="border-b border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">Original</div>
          <pre class="max-h-[460px] overflow-auto py-2 font-mono">${side(rows, "left")}</pre>
        </div>
        <div class="bg-navy-deep/60">
          <div class="border-b border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-cyan/70">Modernized</div>
          <pre class="max-h-[460px] overflow-auto py-2 font-mono">${side(rows, "right")}</pre>
        </div>
      </div>
    </div>`;
}

// ── Report export (Markdown) ────────────────────────────────────────────────
function buildReportMarkdown(data) {
  const summary = data.summary || {};
  const risk = data.riskSummary || {};
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const breakdown = Array.isArray(data.scoreBreakdown) ? data.scoreBreakdown : [];
  const date = new Date().toISOString().slice(0, 10);
  const L = [];

  L.push(`# Cloud Readiness Report — ${summary.fileName || "Analysis"}`);
  L.push("");
  L.push(`_Generated ${date} by ShiftWise Cloud Readiness Analyzer._`);
  L.push("");
  L.push(`- **Cloud Readiness Score:** ${data.cloudReadinessScore} / 100`);
  L.push(`- **Migration Risk:** ${risk.level || "—"}`);
  L.push(
    `- **Findings:** ${findings.filter((f) => f.severity === "High").length} high, ` +
      `${findings.filter((f) => f.severity === "Medium").length} medium, ` +
      `${findings.filter((f) => f.severity === "Low").length} low`
  );
  L.push("");
  if (summary.overview) {
    L.push("## Overview");
    L.push("");
    L.push(summary.overview);
    L.push("");
  }
  if (breakdown.length) {
    L.push("## Score breakdown");
    L.push("");
    L.push("| Layer | Score | Note |");
    L.push("| --- | --- | --- |");
    breakdown.forEach((b) =>
      L.push(`| ${b.layer} | ${b.score} | ${String(b.note || "").replace(/\|/g, "\\|")} |`)
    );
    L.push("");
  }
  const est = data.migrationEstimate;
  if (est && est.effortDaysLow != null) {
    const effort =
      est.effortDaysLow === est.effortDaysHigh
        ? `${est.effortDaysLow} developer-days`
        : `${est.effortDaysLow}–${est.effortDaysHigh} developer-days`;
    L.push(`- **Estimated effort:** ${effort}`);
    L.push(`- **Estimate confidence:** ${est.confidence || "Medium"}`);
  }
  L.push("");
  if (risk.text) {
    L.push("## Migration risk summary");
    L.push("");
    L.push(risk.text);
    L.push("");
  }
  if ((est && (Array.isArray(est.tasks) ? est.tasks.length : false)) || (est && est.rationale)) {
    L.push("## Migration effort");
    L.push("");
    if (est.rationale) {
      L.push(est.rationale);
      L.push("");
    }
    if (Array.isArray(est.tasks) && est.tasks.length) {
      L.push("| Task | Effort (days) |");
      L.push("| --- | ---: |");
      est.tasks.forEach((t) =>
        L.push(`| ${String(t.task || "").replace(/\|/g, "\\|")} | ${t.effortDays} |`)
      );
      L.push("");
    }
  }
  if (findings.length) {
    L.push("## Findings");
    L.push("");
    findings.forEach((f, idx) => {
      L.push(`### ${idx + 1}. ${f.title} _(${f.severity})_`);
      L.push("");
      L.push(`- **Category:** ${f.category}`);
      if (f.location && f.location !== "n/a") L.push(`- **Location:** ${f.location}`);
      L.push("");
      L.push(f.explanation || "");
      L.push("");
      L.push(`**Recommendation:** ${f.recommendation || ""}`);
      L.push("");
    });
  }
  if (data.modernizedCode) {
    L.push("## Modernized code");
    L.push("");
    L.push("```");
    L.push(data.modernizedCode);
    L.push("```");
    L.push("");
  }
  if (data.cloudReadyConfig) {
    L.push("## Cloud-ready configuration");
    L.push("");
    L.push("```");
    L.push(data.cloudReadyConfig);
    L.push("```");
    L.push("");
  }
  const tel = data.telemetry;
  if (tel && Array.isArray(tel.stages) && tel.stages.length) {
    const labels = { detect: "Detection", modernize: "Modernization", score: "Scoring" };
    const cost =
      typeof tel.estimatedCostUsd === "number"
        ? tel.estimatedCostUsd < 0.01
          ? "<$0.01"
          : `$${tel.estimatedCostUsd.toFixed(4)}`
        : "—";
    L.push("## Run stats");
    L.push("");
    L.push(`- Provider: ${tel.provider || "—"}`);
    L.push(`- Model: ${tel.model || "—"}`);
    L.push(`- Total tokens: ${tel.totalTokens} (${tel.promptTokens} in / ${tel.completionTokens} out)`);
    L.push(`- Total time: ${fmtMs(tel.totalMs)}`);
    L.push(`- Estimated cost: ${cost}`);
    L.push("");
    L.push("| Agent | Prompt | Completion | Total | Time |");
    L.push("| --- | ---: | ---: | ---: | ---: |");
    tel.stages.forEach((s) => {
      L.push(
        `| ${labels[s.stage] || s.stage} | ${s.promptTokens} | ${s.completionTokens} | ${s.totalTokens} | ${fmtMs(s.ms)} |`
      );
    });
    L.push("");
  }
  return L.join("\n");
}

function downloadReport() {
  if (!lastResult) return;
  const md = buildReportMarkdown(lastResult);
  const base = (lastResult.summary && lastResult.summary.fileName) || "analysis";
  const safe = base.replace(/[^a-z0-9._-]+/gi, "_");
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cloud-readiness-${safe}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Format a developer-day range, e.g. "2–3 days" or "0.5 day".
function fmtDays(low, high) {
  const d = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  if (low == null && high == null) return "—";
  if (low == null) return `${d(high)} days`;
  if (high == null || low === high) return `${d(low)} ${low === 1 ? "day" : "days"}`;
  return `${d(low)}–${d(high)} days`;
}

// Migration effort estimate card for the Overview tab.
function estimateCard(est, risk) {
  const riskStyle = RISK[(risk && risk.level) || "Medium"] || RISK.Medium;
  const effort = fmtDays(est.effortDaysLow, est.effortDaysHigh);
  const conf = est.confidence || "Medium";
  const confStyle = RISK[conf === "High" ? "Low" : conf === "Low" ? "High" : "Medium"] || RISK.Medium;

  const stat = (label, value, sub) => `
    <div class="rounded-md border border-white/10 bg-navy-deep/50 p-3">
      <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">${label}</div>
      <div class="mt-1 text-lg font-semibold text-slate-100">${esc(value)}</div>
      ${sub ? `<div class="mt-0.5 font-mono text-[10px] text-slate-500">${esc(sub)}</div>` : ""}
    </div>`;

  const tasks = Array.isArray(est.tasks) ? est.tasks : [];
  const tasksHtml = tasks.length
    ? `<div class="mt-4 border-t border-white/10 pt-4">
         <div class="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Effort breakdown</div>
         <div class="space-y-1.5">
           ${tasks
             .map(
               (t) => `
             <div class="flex items-center justify-between gap-3 text-sm">
               <span class="text-slate-300">${esc(t.task)}</span>
               <span class="shrink-0 font-mono text-[11px] text-cyan/80">${esc(fmtDays(t.effortDays, t.effortDays))}</span>
             </div>`
             )
             .join("")}
         </div>
       </div>`
    : "";

  return `
    <div class="rounded-lg border border-cyan/20 bg-navy-panel/60 p-5">
      <div class="flex items-center justify-between">
        <div class="font-mono text-xs uppercase tracking-[0.2em] text-cyan/70">Migration Effort</div>
        <span class="rounded ${confStyle.bg} ${confStyle.ring} border px-2 py-0.5 font-mono text-[10px] ${confStyle.text}">${esc(conf)} confidence</span>
      </div>
      <div class="mt-3 grid grid-cols-3 gap-3">
        ${stat("Migration risk", (risk && risk.level) || "—", "overall")}
        ${stat("Effort", effort, "developer-time")}
        ${stat("Confidence", conf, "scope clarity")}
      </div>
      ${est.rationale ? `<p class="mt-3 text-sm leading-relaxed text-slate-300">${esc(est.rationale)}</p>` : ""}
      ${tasksHtml}
    </div>`;
}

function render(data) {
  lastResult = data;
  const summary = data.summary || {};
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const breakdown = Array.isArray(data.scoreBreakdown) ? data.scoreBreakdown : [];
  const risk = data.riskSummary || {};
  const riskStyle = RISK[risk.level] || RISK.Medium;

  const grouped = {
    "Deprecated API": [],
    "Hardcoded Config": [],
    "Cloud Incompatibility": [],
  };
  findings.forEach((f) => {
    (grouped[f.category] || (grouped[f.category] = [])).push(f);
  });

  const sevCount = (sev) => findings.filter((f) => f.severity === sev).length;

  // --- Build each section's content separately, then show them as tabs --------

  // Overview: score + summary card, plus the migration risk summary.
  let overview = `
    <div class="rounded-lg border border-white/10 bg-navy-panel/60 p-5">
      <div class="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        ${gauge(data.cloudReadinessScore)}
        <div class="flex-1">
          <div class="font-mono text-xs uppercase tracking-[0.2em] text-cyan/70">Cloud Readiness Score</div>
          <h2 class="mt-1 text-lg font-semibold text-slate-100">${esc(summary.fileName || "Analysis")}</h2>
          <p class="mt-1 text-sm leading-relaxed text-slate-300">${esc(summary.overview || data.scoreRationale || "")}</p>
          <div class="mt-3 flex flex-wrap gap-2 font-mono text-[11px]">
            <span class="rounded ${riskStyle.bg} ${riskStyle.ring} border px-2 py-1 ${riskStyle.text}">RISK: ${esc(risk.level || "—")}</span>
            <span class="rounded border border-danger/30 bg-danger/10 px-2 py-1 text-danger">${sevCount("High")} high</span>
            <span class="rounded border border-amber/30 bg-amber/10 px-2 py-1 text-amber">${sevCount("Medium")} medium</span>
            <span class="rounded border border-cyan/30 bg-cyan/10 px-2 py-1 text-cyan">${sevCount("Low")} low</span>
          </div>
        </div>
      </div>
      ${
        breakdown.length
          ? `<div class="mt-5 grid grid-cols-1 gap-4 border-t border-white/10 pt-5 sm:grid-cols-2 lg:grid-cols-4">${breakdown
              .map(breakdownBar)
              .join("")}</div>`
          : ""
      }
    </div>`;

  const estimate = data.migrationEstimate || null;
  if (estimate && estimate.effortDaysLow != null) {
    overview += estimateCard(estimate, risk);
  }

  if (risk.text) {
    overview += `
      <div class="rounded-lg border ${riskStyle.ring} ${riskStyle.bg} p-4">
        <div class="font-mono text-xs uppercase tracking-[0.2em] ${riskStyle.text}">Migration Risk Summary</div>
        <p class="mt-2 text-sm leading-relaxed text-slate-200">${esc(risk.text)}</p>
      </div>`;
  }

  // Findings, grouped by category.
  const order = ["Deprecated API", "Hardcoded Config", "Cloud Incompatibility"];
  const findingsHtml = order
    .filter((cat) => grouped[cat] && grouped[cat].length)
    .map(
      (cat) => `
        <div>
          <div class="mb-2 flex items-center gap-2">
            <h3 class="font-mono text-xs uppercase tracking-[0.2em] text-slate-300">${esc(cat)}</h3>
            <span class="font-mono text-[11px] text-slate-500">(${grouped[cat].length})</span>
          </div>
          <div class="space-y-3">${grouped[cat].map(findingCard).join("")}</div>
        </div>`
    )
    .join("");

  const findingsSection =
    findingsHtml ||
    `<div class="rounded-lg border border-green/30 bg-green/10 p-4 text-sm text-green">No blocking issues detected. The code looks largely cloud-ready.</div>`;

  // Tabs: only include sections that have content.
  const tabs = [
    { id: "overview", label: "Overview", content: overview },
    { id: "findings", label: `Findings (${findings.length})`, content: findingsSection },
  ];
  if (data.modernizedCode) {
    tabs.push({ id: "modernized", label: "Modernized Code", content: `<div id="modWrap"></div>` });
  }
  if (data.cloudReadyConfig) {
    tabs.push({
      id: "config",
      label: "Cloud Config",
      content: codePanel("Cloud-ready configuration", data.cloudReadyConfig, "cloudCfg"),
    });
  }
  if (data.telemetry && Array.isArray(data.telemetry.stages) && data.telemetry.stages.length) {
    tabs.push({ id: "stats", label: "Run Stats", content: statsPanel(data.telemetry) });
  }

  const tabBtn = (t, active) =>
    `<button data-tab="${t.id}" class="-mb-px shrink-0 border-b-2 px-4 py-2 font-mono text-[11px] uppercase tracking-wider transition ${
      active ? "border-cyan text-cyan" : "border-transparent text-slate-400 hover:text-slate-200"
    }">${t.label}</button>`;

  let html = "";

  // Results toolbar — export the analysis as a Markdown report.
  html += `
    <div class="flex items-center justify-between">
      <div class="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Analysis results</div>
      <button id="exportReportBtn" class="rounded-md border border-cyan/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-cyan transition hover:bg-cyan/10">
        ↓ Download report (.md)
      </button>
    </div>`;

  // Tab bar.
  html += `<div role="tablist" class="flex flex-wrap gap-1 overflow-x-auto border-b border-white/10">${tabs
    .map((t, i) => tabBtn(t, i === 0))
    .join("")}</div>`;

  // Tab panels (first visible, rest hidden).
  html += tabs
    .map(
      (t, i) =>
        `<div data-panel="${t.id}" class="space-y-5 ${i === 0 ? "" : "hidden"}">${t.content}</div>`
    )
    .join("");

  els.results.innerHTML = html;

  // Tab switching.
  const tabButtons = els.results.querySelectorAll("[data-tab]");
  const panels = els.results.querySelectorAll("[data-panel]");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.tab;
      tabButtons.forEach((b) => {
        const on = b.dataset.tab === id;
        b.classList.toggle("border-cyan", on);
        b.classList.toggle("text-cyan", on);
        b.classList.toggle("border-transparent", !on);
        b.classList.toggle("text-slate-400", !on);
      });
      panels.forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== id));
    });
  });

  // Export-report button (top of results).
  const exportBtn = document.getElementById("exportReportBtn");
  if (exportBtn) exportBtn.addEventListener("click", downloadReport);

  // Render the modernized-code panel and wire its code/diff toggle.
  const modWrap = document.getElementById("modWrap");
  if (modWrap && data.modernizedCode) {
    const hasDiff = Boolean(lastOriginalCode && lastOriginalCode.trim());
    let mode = "code";
    const paint = () => {
      if (mode === "diff") {
        modWrap.innerHTML = diffPanel(lastOriginalCode, data.modernizedCode);
      } else {
        modWrap.innerHTML = modernizedPanel(data.modernizedCode, hasDiff);
      }
      wireCopy(modWrap);
      const toggle = document.getElementById("diffToggle");
      if (toggle) {
        toggle.addEventListener("click", () => {
          mode = mode === "diff" ? "code" : "diff";
          paint();
        });
      }
    };
    paint();
  }

  wireCopy(els.results);
}

// Run-stats panel: shows token usage, per-agent breakdown, timing, model/
// provider and an estimated cost for the analysis run.
function statsPanel(tel) {
  const stageLabel = {
    detect: "Detection",
    modernize: "Modernization",
    score: "Scoring",
  };
  const num = (n) => (typeof n === "number" ? n.toLocaleString() : "0");
  const cost =
    typeof tel.estimatedCostUsd === "number"
      ? tel.estimatedCostUsd < 0.01
        ? `<$0.01`
        : `$${tel.estimatedCostUsd.toFixed(4)}`
      : "—";

  const stat = (label, value, sub) => `
    <div class="rounded-lg border border-white/10 bg-navy-panel/60 p-4">
      <div class="font-mono text-[11px] uppercase tracking-[0.15em] text-slate-500">${label}</div>
      <div class="mt-1 text-2xl font-semibold text-slate-100">${value}</div>
      ${sub ? `<div class="mt-0.5 font-mono text-[11px] text-slate-500">${sub}</div>` : ""}
    </div>`;

  const cards = `
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      ${stat("Total tokens", num(tel.totalTokens), `${num(tel.promptTokens)} in · ${num(tel.completionTokens)} out`)}
      ${stat("LLM calls", num(tel.stages.length), "one per agent")}
      ${stat("Total time", fmtMs(tel.totalMs), "wall clock")}
      ${stat("Est. cost", cost, "approximate")}
    </div>`;

  const rows = tel.stages
    .map(
      (s) => `
      <tr class="border-t border-white/5">
        <td class="py-2 pr-3 text-slate-200">${esc(stageLabel[s.stage] || s.stage)}</td>
        <td class="py-2 pr-3 text-right font-mono text-slate-300">${num(s.promptTokens)}</td>
        <td class="py-2 pr-3 text-right font-mono text-slate-300">${num(s.completionTokens)}</td>
        <td class="py-2 pr-3 text-right font-mono text-cyan">${num(s.totalTokens)}</td>
        <td class="py-2 text-right font-mono text-slate-400">${fmtMs(s.ms)}</td>
      </tr>`
    )
    .join("");

  const table = `
    <div class="rounded-lg border border-white/10 bg-navy-panel/50 p-4">
      <div class="mb-2 font-mono text-xs uppercase tracking-[0.15em] text-cyan/70">Per-agent usage</div>
      <table class="w-full text-sm">
        <thead>
          <tr class="font-mono text-[11px] uppercase tracking-wider text-slate-500">
            <th class="py-1 pr-3 text-left font-normal">Agent</th>
            <th class="py-1 pr-3 text-right font-normal">Prompt</th>
            <th class="py-1 pr-3 text-right font-normal">Completion</th>
            <th class="py-1 pr-3 text-right font-normal">Total</th>
            <th class="py-1 text-right font-normal">Time</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  const meta = `
    <div class="flex flex-wrap gap-2 font-mono text-[11px]">
      <span class="rounded border border-white/10 bg-white/5 px-2 py-1 text-slate-300">provider: ${esc(tel.provider || "—")}</span>
      <span class="rounded border border-white/10 bg-white/5 px-2 py-1 text-slate-300">model: ${esc(tel.model || "—")}</span>
    </div>`;

  return cards + table + meta;
}

// Modernized code panel with a "diff view" toggle in its header (when a diff is
// available). Mirrors codePanel() but adds the toggle button.
function modernizedPanel(code, hasDiff) {
  return `
    <div class="rounded-lg border border-white/10 bg-navy-panel/50">
      <div class="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <span class="font-mono text-xs uppercase tracking-[0.15em] text-cyan/70">Modernized code</span>
        <div class="flex items-center gap-3">
          ${
            hasDiff
              ? `<button id="diffToggle" class="font-mono text-[11px] uppercase tracking-wider text-slate-400 hover:text-cyan">diff view</button>`
              : ""
          }
          <button data-copy="modCode" class="font-mono text-[11px] uppercase tracking-wider text-slate-400 hover:text-cyan">copy</button>
        </div>
      </div>
      <pre id="modCode" class="max-h-[460px] overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200">${esc(code)}</pre>
    </div>`;
}

function wireCopy(root) {
  root.querySelectorAll("[data-copy]").forEach((btn) => {
    if (btn.dataset.copyWired) return;
    btn.dataset.copyWired = "1";
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.getAttribute("data-copy"));
      if (!target) return;
      navigator.clipboard.writeText(target.textContent).then(() => {
        const old = btn.textContent;
        btn.textContent = "copied";
        setTimeout(() => (btn.textContent = old), 1200);
      });
    });
  });
}
