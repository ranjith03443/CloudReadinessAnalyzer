const $ = (id) => document.getElementById(id);

const els = {
  language: $("language"),
  targetCloud: $("targetCloud"),
  targetArchitecturePattern: $("targetArchitecturePattern"),
  codeFile: $("codeFile"),
  codeFolder: $("codeFolder"),
  selectFolderBtn: $("selectFolderBtn"),
  folderInfo: $("folderInfo"),
  code: $("code"),
  plannerNotes: $("plannerNotes"),
  detectedConfigWrap: $("detectedConfigWrap"),
  detectedConfigChips: $("detectedConfigChips"),
  detectedConfigNote: $("detectedConfigNote"),
  analyzeBtn: $("analyzeBtn"),
  runDemoBtn: $("runDemoBtn"),
  loadSampleBtn: $("loadSampleBtn"),
  inputError: $("inputError"),
  newRunForm: $("newRunForm"),
  newRunTitle: $("newRunTitle"),
  loadingState: $("loadingState"),
  pipeline: $("pipeline"),
  liveTokens: $("liveTokens"),
  liveTokenCount: $("liveTokenCount"),
  results: $("results"),
  pastRunsView: $("pastRunsView"),
  modelTag: $("modelTag"),
  sourceModeTabs: $("sourceModeTabs"),
  repoUrl: $("repoUrl"),
  repoBranch: $("repoBranch"),
  ingestRepoBtn: $("ingestRepoBtn"),
  localPath: $("localPath"),
  ingestLocalBtn: $("ingestLocalBtn"),
  roleSwitcher: $("roleSwitcher"),
  newRunNavBtn: $("newRunNavBtn"),
  pastRunsBtn: $("pastRunsBtn"),
  auditLogBtn: $("auditLogBtn"),
  costBudgetBtn: $("costBudgetBtn"),
  settingsBtn: $("settingsBtn"),
  aiProvider: $("aiProvider"),
  aiModel: $("aiModel"),
  providerHint: $("providerHint"),
  modalOverlay: $("modalOverlay"),
  modalTitle: $("modalTitle"),
  modalCloseBtn: $("modalCloseBtn"),
  modalBody: $("modalBody"),
};

// Phase 1 (assessment) stages, in the order the real graph fans them out:
// detect + dependency in parallel, then score + strategize (both need
// detect; strategize also needs dependency), then estimate (needs strategize).
const STAGES = [
  { key: "detect", label: "Code Intelligence agent", desc: "Scanning for deprecated APIs, hardcoded config & cloud blockers" },
  { key: "dependency", label: "Dependency Analysis agent", desc: "Extracting imports/references & flagging migration risk" },
  { key: "score", label: "Scoring / Risk agent", desc: "Computing the cloud readiness score" },
  { key: "strategize", label: "Strategy Planner agent", desc: "Recommending a migration type & target architecture" },
  { key: "estimate", label: "Estimation agent", desc: "Sizing the effort for the recommended approach" },
];

// --- Demo role switcher (NOT a login — see roles.js) -------------------------
let actingRole = "viewer";

function setActingRole(role) {
  actingRole = role;
  document.querySelectorAll(".role-btn").forEach((btn) => {
    const active = btn.dataset.role === role;
    btn.classList.toggle("bg-cyan/15", active);
    btn.classList.toggle("text-cyan", active);
    btn.classList.toggle("text-slate-400", !active);
  });
  // Audit Log / Cost & Budget / Settings are architect-only — hidden here,
  // and enforced server-side too (403 for viewer regardless of what the UI shows).
  if (els.auditLogBtn) els.auditLogBtn.classList.toggle("hidden", role !== "architect");
  if (els.costBudgetBtn) els.costBudgetBtn.classList.toggle("hidden", role !== "architect");
  if (els.settingsBtn) els.settingsBtn.classList.toggle("hidden", role !== "architect");
  refreshGateButtonsForRole();
}

// Disables (rather than hides) Gate A / Gate B action buttons for the
// non-architect role, so the buttons' existence and the real reason they're
// blocked are both visible — not just a silent 403 after clicking. Called
// on every role switch so an already-rendered gate panel updates live.
function refreshGateButtonsForRole() {
  const isArchitect = actingRole === "architect";
  ["gateProceedBtn", "gateStopBtn", "gateApproveBtn", "gateRejectBtn"].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = !isArchitect;
    btn.title = isArchitect ? "" : 'Requires the "Architect" role — switch it in the header.';
  });
}

if (els.roleSwitcher) {
  els.roleSwitcher.querySelectorAll(".role-btn").forEach((btn) => {
    btn.addEventListener("click", () => setActingRole(btn.dataset.role));
  });
  setActingRole("viewer");
}

// --- Modal: reused by Audit Log, Cost & Budget and Settings ------------------
function openModal(title) {
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = `<p class="text-sm text-slate-400">Loading…</p>`;
  els.modalOverlay.classList.remove("hidden");
  els.modalOverlay.classList.add("flex");
}
function closeModal() {
  els.modalOverlay.classList.add("hidden");
  els.modalOverlay.classList.remove("flex");
}
if (els.modalCloseBtn) els.modalCloseBtn.addEventListener("click", closeModal);
if (els.modalOverlay) {
  els.modalOverlay.addEventListener("click", (e) => {
    if (e.target === els.modalOverlay) closeModal();
  });
}

const RUN_STATUS_STYLE = {
  pending_gate_a: "border-cyan/30 bg-cyan/10 text-cyan",
  pending_gate_b: "border-amber/30 bg-amber/10 text-amber",
  stopped: "border-white/20 bg-white/5 text-slate-300",
  approved: "border-green/30 bg-green/10 text-green",
  rejected: "border-danger/30 bg-danger/10 text-danger",
};

function statusBadge(status) {
  const style = RUN_STATUS_STYLE[status] || RUN_STATUS_STYLE.pending_gate_a;
  return `<span class="rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${style}">${esc(status || "—")}</span>`;
}

// Past Runs lives in the main pane (view "pastRuns"), not a modal — list and
// detail both render into #pastRunsView, same pattern as the New Run form.
function pastRunsHeader(title) {
  return `
    <div class="border-b border-white/10 pb-4">
      <div class="font-mono text-xs uppercase tracking-[0.2em] text-cyan/70">Past Runs</div>
      <h1 class="mt-0.5 text-xl font-semibold">${esc(title)}</h1>
    </div>`;
}

async function openPastRuns() {
  setView("pastRuns");
  els.pastRunsView.innerHTML = pastRunsHeader("All runs") + `<p class="text-sm text-slate-400">Loading…</p>`;
  try {
    const res = await apiFetch("api/runs");
    const body = await res.json();
    if (!res.ok) {
      els.pastRunsView.innerHTML = pastRunsHeader("All runs") + `<p class="text-sm text-danger">${esc(body.error || "Could not load runs.")}</p>`;
      return;
    }
    const runs = body.runs || [];
    if (!runs.length) {
      els.pastRunsView.innerHTML = pastRunsHeader("All runs") + `<p class="text-sm text-slate-400">No runs yet.</p>`;
      return;
    }
    els.pastRunsView.innerHTML =
      pastRunsHeader("All runs") +
      `<div class="space-y-2">
        ${runs
          .map(
            (r) => `
          <button data-run-id="${r.id}" class="run-row block w-full rounded-md border border-white/10 bg-navy-panel/60 p-3 text-left transition hover:border-cyan/30">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm text-slate-100">${esc(r.fileName || "Analysis")}</span>
              ${statusBadge(r.status)}
            </div>
            <div class="mt-1 flex items-center gap-3 font-mono text-[11px] text-slate-500">
              <span>${esc(r.language || "—")}</span>
              <span>score: ${r.cloudReadinessScore ?? "—"}</span>
              <span>${new Date(r.createdAt).toLocaleString()}</span>
            </div>
          </button>`
          )
          .join("")}
      </div>`;
    els.pastRunsView.querySelectorAll(".run-row").forEach((btn) => {
      btn.addEventListener("click", () => showRunDetail(btn.dataset.runId));
    });
  } catch {
    els.pastRunsView.innerHTML = pastRunsHeader("All runs") + `<p class="text-sm text-danger">Could not reach the server.</p>`;
  }
}

async function showRunDetail(runId) {
  setView("pastRuns");
  els.pastRunsView.innerHTML = pastRunsHeader("Run detail") + `<p class="text-sm text-slate-400">Loading…</p>`;
  try {
    const res = await apiFetch(`api/runs/${runId}`);
    const run = await res.json();
    if (!res.ok) {
      els.pastRunsView.innerHTML = pastRunsHeader("Run detail") + `<p class="text-sm text-danger">${esc(run.error || "Could not load run.")}</p>`;
      return;
    }
    const rev = run.assessmentRevisions[run.assessmentRevisions.length - 1];
    const a = rev.result;
    const t = run.transformation;
    els.pastRunsView.innerHTML =
      pastRunsHeader("Run detail") +
      `<button id="backToListBtn" class="font-mono text-[11px] uppercase tracking-wider text-cyan/70 hover:text-cyan">← back to list</button>
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold text-slate-100">${esc(rev.inputs.fileName || "Analysis")}</span>
          ${statusBadge(run.status)}
        </div>
        <div class="rounded-md border border-white/10 bg-navy-panel/60 p-3 text-sm text-slate-300">
          <div>Language: ${esc(rev.inputs.language)} · Target: ${esc(rev.inputs.targetCloud)}${rev.inputs.targetArchitecturePattern ? " / " + esc(rev.inputs.targetArchitecturePattern) : ""}</div>
          <div class="mt-1">Score: ${a.cloudReadinessScore} / 100 · Strategy: ${esc(a.recommendedStrategy)} (${a.migrationType === "cross-tech" ? "cross-tech → " + esc(a.targetLanguage || "?") : "same-language"})</div>
          <div class="mt-1">Revisions: ${run.assessmentRevisions.length}</div>
        </div>
        ${
          run.gateADecision
            ? `<div class="rounded-md border border-white/10 bg-navy-panel/60 p-3 text-sm text-slate-300">
                <div class="font-mono text-[10px] uppercase tracking-wider text-slate-500">Gate A</div>
                ${esc(run.gateADecision.action)} by ${esc(run.gateADecision.decidedByRole)} on ${new Date(run.gateADecision.decidedAt).toLocaleString()}
              </div>`
            : ""
        }
        ${
          t
            ? `<div class="rounded-md border border-white/10 bg-navy-panel/60 p-3 text-sm text-slate-300">
                <div class="font-mono text-[10px] uppercase tracking-wider text-slate-500">Transformation</div>
                Manual review recommended: ${t.manualReviewRecommended ? "Yes" : "No"}
              </div>`
            : ""
        }
        ${
          run.gateBDecision
            ? `<div class="rounded-md border border-white/10 bg-navy-panel/60 p-3 text-sm text-slate-300">
                <div class="font-mono text-[10px] uppercase tracking-wider text-slate-500">Gate B</div>
                ${esc(run.status)} by ${esc(run.gateBDecision.decidedByRole)} on ${new Date(run.gateBDecision.decidedAt).toLocaleString()}
                ${run.gateBDecision.comment ? `<div class="mt-1 italic">"${esc(run.gateBDecision.comment)}"</div>` : ""}
              </div>`
            : ""
        }
        <button id="reopenRunBtn" class="w-full rounded-md border border-cyan/40 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-cyan transition hover:bg-cyan/10">
          Open in main view
        </button>
      </div>`;
    document.getElementById("backToListBtn").addEventListener("click", openPastRuns);
    document.getElementById("reopenRunBtn").addEventListener("click", () => {
      currentRunId = run.id;
      currentRevision = run.currentRevision;
      currentRunStatus = run.status;
      isDemoRun = false;
      lastOriginalCode = rev.inputs.code;
      currentRunInputsSnapshot = rev.inputs;
      render({
        ...a,
        ...(t || {}),
        preferredMigrationType: rev.inputs.preferredMigrationType,
        preferredTargetLanguage: rev.inputs.preferredTargetLanguage,
        gateBDecision: run.gateBDecision,
      });
      setView("results");
    });
  } catch {
    els.pastRunsView.innerHTML = pastRunsHeader("Run detail") + `<p class="text-sm text-danger">Could not reach the server.</p>`;
  }
}

async function openAuditLog() {
  openModal("Audit Log");
  try {
    const res = await apiFetch("api/audit");
    const body = await res.json();
    if (!res.ok) {
      els.modalBody.innerHTML = `<p class="text-sm text-danger">${esc(body.error || "Could not load the audit log.")}</p>`;
      return;
    }
    const entries = body.audit || [];
    if (!entries.length) {
      els.modalBody.innerHTML = `<p class="text-sm text-slate-400">No audit entries yet.</p>`;
      return;
    }
    els.modalBody.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="border-b border-white/10 text-slate-500">
              <th class="pb-2 pr-3 font-mono uppercase tracking-wider">Time</th>
              <th class="pb-2 pr-3 font-mono uppercase tracking-wider">Role</th>
              <th class="pb-2 pr-3 font-mono uppercase tracking-wider">Action</th>
              <th class="pb-2 pr-3 font-mono uppercase tracking-wider">Run</th>
              <th class="pb-2 font-mono uppercase tracking-wider">Details</th>
            </tr>
          </thead>
          <tbody>
            ${entries
              .slice()
              .reverse()
              .map(
                (e) => `
              <tr class="border-t border-white/5">
                <td class="py-2 pr-3 text-slate-400">${new Date(e.ts).toLocaleString()}</td>
                <td class="py-2 pr-3 text-slate-300">${esc(e.actingRole)}</td>
                <td class="py-2 pr-3 text-cyan">${esc(e.action)}</td>
                <td class="py-2 pr-3 font-mono text-slate-500">${e.runId ? esc(e.runId.slice(0, 8)) : "—"}</td>
                <td class="py-2 text-slate-400">${esc(JSON.stringify(e.details || {}))}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
  } catch {
    els.modalBody.innerHTML = `<p class="text-sm text-danger">Could not reach the server.</p>`;
  }
}

function fmtUsd(n) {
  if (typeof n !== "number") return "—";
  return n < 0.01 ? "<$0.01" : `$${n.toFixed(4)}`;
}

async function openCostBudget() {
  openModal("AI Cost & Budget");
  els.modalBody.innerHTML = `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="block text-[11px] font-medium text-slate-400">From</label>
        <input id="costFrom" type="date" class="mt-1 rounded-md border border-white/15 bg-navy-deep px-2 py-1.5 text-sm" />
      </div>
      <div>
        <label class="block text-[11px] font-medium text-slate-400">To</label>
        <input id="costTo" type="date" class="mt-1 rounded-md border border-white/15 bg-navy-deep px-2 py-1.5 text-sm" />
      </div>
      <div>
        <label class="block text-[11px] font-medium text-slate-400">Run ID</label>
        <input id="costRunId" type="text" placeholder="filter by run…" class="mt-1 w-40 rounded-md border border-white/15 bg-navy-deep px-2 py-1.5 text-sm" />
      </div>
      <button id="costFilterBtn" class="rounded-md border border-cyan/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-cyan hover:bg-cyan/10">Apply</button>
      ${currentRunId ? `<button id="costThisRunBtn" class="rounded-md border border-white/20 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-slate-300 hover:bg-white/5">This run</button>` : ""}
    </div>
    <div id="costResults"><p class="text-sm text-slate-400">Loading…</p></div>`;

  async function loadCost() {
    const from = document.getElementById("costFrom").value;
    const to = document.getElementById("costTo").value;
    const runId = document.getElementById("costRunId").value.trim();
    const params = new URLSearchParams();
    if (from) params.set("dateFrom", from);
    if (to) params.set("dateTo", to);
    if (runId) params.set("runId", runId);

    const target = document.getElementById("costResults");
    target.innerHTML = `<p class="text-sm text-slate-400">Loading…</p>`;
    try {
      const res = await apiFetch(`api/cost?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) {
        target.innerHTML = `<p class="text-sm text-danger">${esc(body.error || "Could not load cost data.")}</p>`;
        return;
      }
      const { entries, totals } = body;
      const stat = (label, value) => `
        <div class="rounded-md border border-white/10 bg-navy-deep/50 p-3">
          <div class="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">${label}</div>
          <div class="mt-1 text-lg font-semibold text-slate-100">${value}</div>
        </div>`;
      target.innerHTML = `
        <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          ${stat("Total cost", fmtUsd(totals.totalCostUsd))}
          ${stat("Total tokens", totals.totalTokens.toLocaleString())}
          ${stat("AI calls", entries.length)}
          ${stat("Providers", Object.keys(totals.byProvider).join(", ") || "—")}
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="border-b border-white/10 text-slate-500">
                <th class="pb-2 pr-3 font-mono uppercase tracking-wider">Time</th>
                <th class="pb-2 pr-3 font-mono uppercase tracking-wider">Run</th>
                <th class="pb-2 pr-3 font-mono uppercase tracking-wider">Phase</th>
                <th class="pb-2 pr-3 font-mono uppercase tracking-wider">Agent</th>
                <th class="pb-2 pr-3 font-mono uppercase tracking-wider">Provider/Model</th>
                <th class="pb-2 pr-3 text-right font-mono uppercase tracking-wider">Tokens</th>
                <th class="pb-2 text-right font-mono uppercase tracking-wider">Cost</th>
              </tr>
            </thead>
            <tbody>
              ${entries
                .slice()
                .reverse()
                .map(
                  (e) => `
                <tr class="border-t border-white/5">
                  <td class="py-2 pr-3 text-slate-400">${new Date(e.ts).toLocaleString()}</td>
                  <td class="py-2 pr-3 font-mono text-slate-500">${esc((e.runId || "").slice(0, 8))}</td>
                  <td class="py-2 pr-3 text-slate-300">${esc(e.phase)}</td>
                  <td class="py-2 pr-3 text-cyan">${esc(e.agent)}</td>
                  <td class="py-2 pr-3 text-slate-400">${esc(e.provider)}/${esc(e.model)}</td>
                  <td class="py-2 pr-3 text-right font-mono text-slate-300">${e.totalTokens.toLocaleString()}</td>
                  <td class="py-2 text-right font-mono text-cyan">${fmtUsd(e.costUsd)}</td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
          ${!entries.length ? `<p class="mt-3 text-sm text-slate-400">No AI calls match this filter.</p>` : ""}
        </div>`;
    } catch {
      target.innerHTML = `<p class="text-sm text-danger">Could not reach the server.</p>`;
    }
  }

  document.getElementById("costFilterBtn").addEventListener("click", loadCost);
  const thisRunBtn = document.getElementById("costThisRunBtn");
  if (thisRunBtn) {
    thisRunBtn.addEventListener("click", () => {
      document.getElementById("costRunId").value = currentRunId;
      loadCost();
    });
  }
  loadCost();
}

async function openSettings() {
  openModal("Settings");
  try {
    const [provRes, defRes] = await Promise.all([apiFetch("api/settings/providers"), apiFetch("api/settings/default")]);
    const provBody = await provRes.json();
    const def = await defRes.json();
    const provList = provBody.providers || [];

    els.modalBody.innerHTML = `
      <div class="space-y-4">
        <div>
          <div class="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-slate-300">Provider credential status</div>
          <div class="space-y-1.5">
            ${provList
              .map(
                (p) => `
              <div class="flex items-center justify-between rounded-md border border-white/10 bg-navy-deep/40 p-2.5 text-sm">
                <span class="text-slate-200">${esc(p.label)}</span>
                <span class="font-mono text-[10px] uppercase tracking-wider ${p.available ? "text-green" : "text-slate-500"}">${p.available ? "configured" : "no credentials"}</span>
              </div>`
              )
              .join("")}
          </div>
          <p class="mt-2 text-[11px] text-slate-500">Credentials are read from .env — no API keys are entered here.</p>
        </div>
        <div>
          <div class="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-slate-300">Default provider &amp; model for new runs</div>
          <div class="grid grid-cols-2 gap-3">
            <select id="settingsProvider" class="rounded-md border border-white/15 bg-navy-deep px-3 py-2 text-sm">
              ${provList.map((p) => `<option value="${p.id}" ${!p.available ? "disabled" : ""}>${esc(p.label)}</option>`).join("")}
            </select>
            <select id="settingsModel" class="rounded-md border border-white/15 bg-navy-deep px-3 py-2 text-sm"></select>
          </div>
          <button id="settingsSaveBtn" class="mt-3 w-full rounded-md bg-cyan px-4 py-2 font-semibold text-navy-deep transition hover:bg-cyan/90">Save default</button>
          <p id="settingsStatus" class="mt-2 text-sm"></p>
        </div>
      </div>`;

    const provSel = document.getElementById("settingsProvider");
    const modelSel = document.getElementById("settingsModel");
    function fillModels() {
      const p = provList.find((x) => x.id === provSel.value);
      modelSel.innerHTML = (p?.models || []).map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
    }
    provSel.addEventListener("change", fillModels);
    if (def.defaultProvider) provSel.value = def.defaultProvider;
    fillModels();
    if (def.defaultModel) modelSel.value = def.defaultModel;

    document.getElementById("settingsSaveBtn").addEventListener("click", async () => {
      const statusEl = document.getElementById("settingsStatus");
      try {
        const res = await apiFetch("api/settings/default", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: provSel.value, model: modelSel.value }),
        });
        const body = await res.json();
        if (!res.ok) {
          statusEl.textContent = body.error || "Could not save.";
          statusEl.className = "mt-2 text-sm text-danger";
          return;
        }
        statusEl.textContent = "Saved. New runs will default to this selection.";
        statusEl.className = "mt-2 text-sm text-green";
        loadProviderCatalog();
      } catch {
        statusEl.textContent = "Could not reach the server.";
        statusEl.className = "mt-2 text-sm text-danger";
      }
    });
  } catch {
    els.modalBody.innerHTML = `<p class="text-sm text-danger">Could not reach the server.</p>`;
  }
}

// Sidebar "New Run": always starts fresh — clears any current run context
// and every field, back to a clean form. Distinct from "Edit inputs" in the
// results toolbar (editRunInputs, below), which keeps the current run and
// its field values so they can be tweaked before re-assessing.
function startNewRun() {
  currentRunId = null;
  currentRevision = null;
  currentRunStatus = null;
  isDemoRun = false;
  editingCurrentRun = false;
  lastResult = null;
  lastOriginalCode = "";
  currentRunInputsSnapshot = null;
  ingestedFileName = null;

  els.code.value = "";
  els.codeFile.value = "";
  els.codeFolder.value = "";
  if (els.plannerNotes) els.plannerNotes.value = "";
  clearIngestedConfig();
  if (els.folderInfo) els.folderInfo.textContent = "";
  const repoInfo = $("ingestInfo-repoUrl");
  const localInfo = $("ingestInfo-localPath");
  if (repoInfo) repoInfo.textContent = "";
  if (localInfo) localInfo.textContent = "";
  if (els.repoUrl) els.repoUrl.value = "";
  if (els.repoBranch) els.repoBranch.value = "";
  if (els.localPath) els.localPath.value = "";

  setSourceMode("upload");
  setMigrationGoal("unsure");
  if (els.newRunTitle) els.newRunTitle.textContent = "Ingest & configure";
  clearError();
  setView("form");
}

// Results toolbar "Edit inputs": non-destructive — reveals the form with the
// current run's field values still in place so they can be tweaked, and
// flags that the next Start Assessment / Run demo click should re-assess
// this run (editingCurrentRun) rather than create a new one.
function editRunInputs() {
  editingCurrentRun = true;
  if (els.newRunTitle) els.newRunTitle.textContent = `Editing run · revision ${currentRevision}`;
  clearError();
  setView("form");
}

// Results toolbar "Duplicate as new run": for a run that's past Gate A
// (inputs locked server-side — see reassess's 409 in server.js), pre-fills a
// FRESH run's form from currentRunInputsSnapshot rather than editing in
// place. Unlike editRunInputs, this clears run-tracking state so the next
// Start Assessment / Run demo click creates a brand-new run.
function duplicateAsNewRun() {
  const inputs = currentRunInputsSnapshot;
  if (!inputs) return;

  currentRunId = null;
  currentRevision = null;
  currentRunStatus = null;
  isDemoRun = false;
  editingCurrentRun = false;

  setSourceMode("paste");
  els.code.value = inputs.code || "";
  ingestedConfig = inputs.config || "";
  ingestedConfigFiles = Array.isArray(inputs.configFiles) ? inputs.configFiles : [];
  renderDetectedConfig(ingestedConfigFiles.length ? ingestedConfigFiles : null);
  if (els.plannerNotes) els.plannerNotes.value = inputs.plannerNotes || "";
  lastOriginalCode = inputs.code || "";
  if (inputs.language) els.language.value = inputs.language;
  if (inputs.targetCloud) els.targetCloud.value = inputs.targetCloud;
  refreshArchitecturePatternOptions();
  els.targetArchitecturePattern.value = inputs.targetArchitecturePattern || "";

  const goal = inputs.preferredMigrationType === "cross-tech" ? "cross-tech" : inputs.preferredMigrationType === "same-language" ? "cloud-readiness" : "unsure";
  setMigrationGoal(goal);
  refreshPreferredTargetLanguageOptions();
  const preferredTargetLanguageEl = $("preferredTargetLanguage");
  if (goal === "cross-tech" && inputs.preferredTargetLanguage && preferredTargetLanguageEl) {
    preferredTargetLanguageEl.value = inputs.preferredTargetLanguage;
  }

  if (inputs.provider && els.aiProvider && [...els.aiProvider.options].some((o) => o.value === inputs.provider)) {
    els.aiProvider.value = inputs.provider;
    populateModelOptions(inputs.provider);
    if (inputs.model && els.aiModel) els.aiModel.value = inputs.model;
  }

  if (els.newRunTitle) els.newRunTitle.textContent = "Duplicated from a previous run";
  clearError();
  setView("form");
}

if (els.newRunNavBtn) els.newRunNavBtn.addEventListener("click", startNewRun);
if (els.pastRunsBtn) els.pastRunsBtn.addEventListener("click", openPastRuns);
if (els.auditLogBtn) els.auditLogBtn.addEventListener("click", openAuditLog);
if (els.costBudgetBtn) els.costBudgetBtn.addEventListener("click", openCostBudget);
if (els.settingsBtn) els.settingsBtn.addEventListener("click", openSettings);

// Wrapper around fetch() that always sends the current acting role — every
// call site should use this instead of the raw fetch, so Gate A / Gate B /
// audit / cost / settings routes are gated consistently.
function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), "X-Acting-Role": actingRole },
  });
}

// The current run's id/revision (once an assessment has been created) and
// its latest known status — drives whether "Re-assess" / Gate A actions show.
let currentRunId = null;
let currentRevision = null;
let currentRunStatus = null;
let isDemoRun = false;
// True while the form is showing to let the user tweak an EXISTING run's
// inputs before re-assessing (via "Edit inputs" in the results toolbar) —
// as opposed to a fresh "New Run". Determines whether the next Start
// Assessment / Run demo click reassesses currentRunId or starts a new run.
let editingCurrentRun = false;
// The inputs (code, config, language, targetCloud, targetArchitecturePattern,
// preferredMigrationType, preferredTargetLanguage, provider, model) behind
// whichever run is currently loaded — set whenever a run is created/
// reassessed (analyze()) or reopened from Past Runs (showRunDetail). Once a
// run is past Gate A its inputs are server-side locked (no more editing in
// place), so "Duplicate as new run" reads this snapshot to pre-fill a fresh
// run with the same inputs instead.
let currentRunInputsSnapshot = null;

// The most recent successful analysis + the exact source that produced it.
// Used by the report export and the before/after diff view.
let lastResult = null;
let lastOriginalCode = "";
let liveTokenTotal = 0;

// Set when a Repository URL / Local folder path ingest succeeds, so
// combinedFileName() can prefer it over the upload-based file inputs.
let ingestedFileName = null;

// Config is no longer entered by hand — it's whatever /api/ingest detected in
// the ingested source (web.config, appsettings*.json, application*.yml, …).
// ingestedConfigFiles is the display list; ingestedConfig is the combined text
// sent to the pipeline. Both reset on New Run and on a fresh upload/ingest.
let ingestedConfig = "";
let ingestedConfigFiles = [];

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

function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Extensions treated as analyzable source code. Folder uploads contain lots of
// unrelated files, so we keep only these. Mirrors ingest.js's server-side
// extension map for the Repository URL / Local path modes.
const CODE_EXTENSIONS = [".cs", ".java", ".vb", ".cbl", ".cob", ".bas", ".cls", ".frm", ".php", ".py"];

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

// A display name for the submitted code: an ingested repo/folder's name, the
// single file's name, a combined label for a multi-file selection, or
// "pasted-code" when typed in directly.
function combinedFileName() {
  if (ingestedFileName) return ingestedFileName;
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
  // A fresh file selection supersedes any previous folder pick or ingest.
  els.codeFolder.value = "";
  els.folderInfo.textContent = "";
  ingestedFileName = null;
  clearIngestedConfig();
  readCodeFiles(els.codeFile, els.code).catch(() =>
    showError("Could not read one of the selected files.")
  );
});

els.selectFolderBtn.addEventListener("click", () => els.codeFolder.click());

els.codeFolder.addEventListener("change", async () => {
  // A fresh folder selection supersedes any previous file pick or ingest.
  els.codeFile.value = "";
  ingestedFileName = null;
  clearIngestedConfig();
  try {
    const count = await readCodeFolder(els.codeFolder, els.code);
    if (count === 0) {
      els.folderInfo.textContent = "no matching source files found in that folder";
      els.folderInfo.className = "text-[11px] text-amber";
    } else {
      els.folderInfo.textContent = `${count} code file${count === 1 ? "" : "s"} loaded from folder`;
      els.folderInfo.className = "text-[11px] text-cyan/80";
    }
  } catch {
    showError("Could not read the selected folder.");
  }
});

els.loadSampleBtn.addEventListener("click", async () => {
  try {
    const isJava = els.language.value === "Java";
    const codePath = isJava ? "samples/LegacyOrderService.java" : "samples/LegacyOrderService.cs";
    const codeRes = await fetch(codePath);
    if (codeRes.ok) els.code.value = await codeRes.text();
    ingestedFileName = null;
    clearIngestedConfig();
  } catch {
    showError("Could not load the sample file.");
  }
});

// --- Source mode: Upload / Repository URL / Local folder path ---------------

const SOURCE_MODE_BTN_ACTIVE = ["border-cyan", "bg-cyan/10", "text-cyan"];
const SOURCE_MODE_BTN_INACTIVE = ["border-transparent", "text-slate-400"];
let sourceMode = "upload";

function setSourceMode(mode) {
  sourceMode = mode;
  document.querySelectorAll(".source-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `sourcePanel-${mode}`);
  });
  document.querySelectorAll(".source-mode-btn").forEach((btn) => {
    const active = btn.dataset.sourceMode === mode;
    btn.classList.toggle("border", true);
    SOURCE_MODE_BTN_ACTIVE.forEach((c) => btn.classList.toggle(c, active));
    SOURCE_MODE_BTN_INACTIVE.forEach((c) => btn.classList.toggle(c, !active));
  });
  clearError();
}

if (els.sourceModeTabs) {
  els.sourceModeTabs.querySelectorAll(".source-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setSourceMode(btn.dataset.sourceMode));
  });
  setSourceMode("upload");
}

// --- Migration goal: Let AI decide / Cloud Readiness / Cross-Tech Migration -
// A stated preference, not a forced outcome — the Strategy Planner reviews it
// against the actual code and explains itself if it disagrees, same as it
// already does for Target Cloud / Architecture Pattern.
const MIGRATION_GOAL_BTN_ACTIVE = ["border-cyan", "bg-cyan/10", "text-cyan"];
const MIGRATION_GOAL_BTN_INACTIVE = ["border-transparent", "text-slate-400"];
let migrationGoal = "unsure";

function refreshPreferredTargetLanguageOptions() {
  const wrap = $("preferredTargetLanguageWrap");
  const sel = $("preferredTargetLanguage");
  if (!wrap || !sel) return;
  Array.from(sel.options).forEach((opt) => {
    opt.hidden = opt.value === els.language.value;
  });
  if (sel.value === els.language.value) {
    const firstOther = Array.from(sel.options).find((o) => o.value !== els.language.value);
    if (firstOther) sel.value = firstOther.value;
  }
}

function setMigrationGoal(goal) {
  migrationGoal = goal;
  document.querySelectorAll(".migration-goal-btn").forEach((btn) => {
    const active = btn.dataset.migrationGoal === goal;
    btn.classList.toggle("border", true);
    MIGRATION_GOAL_BTN_ACTIVE.forEach((c) => btn.classList.toggle(c, active));
    MIGRATION_GOAL_BTN_INACTIVE.forEach((c) => btn.classList.toggle(c, !active));
  });
  const wrap = $("preferredTargetLanguageWrap");
  if (wrap) {
    wrap.classList.toggle("hidden", goal !== "cross-tech");
    if (goal === "cross-tech") refreshPreferredTargetLanguageOptions();
  }
}

const migrationGoalTabs = $("migrationGoalTabs");
if (migrationGoalTabs) {
  migrationGoalTabs.querySelectorAll(".migration-goal-btn").forEach((btn) => {
    btn.addEventListener("click", () => setMigrationGoal(btn.dataset.migrationGoal));
  });
  setMigrationGoal("unsure");
  els.language.addEventListener("change", refreshPreferredTargetLanguageOptions);
}

// --- Deployment target → architecture pattern -------------------------------
// Serverless / PaaS only make sense for a public cloud; an on-premise /
// portable target offers Containers or Virtual machines instead. Rebuild the
// pattern <select> whenever the deployment target changes, keeping the current
// choice if it's still valid.
const ARCH_PATTERNS_CLOUD = ["Containers", "PaaS", "Serverless"];
const ARCH_PATTERNS_ONPREM = ["Containers", "Virtual machines"];
const ONPREM_TARGET = "On-premise / portable";

function refreshArchitecturePatternOptions() {
  const sel = els.targetArchitecturePattern;
  if (!sel || !els.targetCloud) return;
  const prev = sel.value;
  const patterns = els.targetCloud.value === ONPREM_TARGET ? ARCH_PATTERNS_ONPREM : ARCH_PATTERNS_CLOUD;
  sel.innerHTML =
    `<option value="">Let AI recommend</option>` +
    patterns.map((p) => `<option value="${p}">${p}</option>`).join("");
  sel.value = patterns.includes(prev) ? prev : "";
}

if (els.targetCloud) {
  els.targetCloud.addEventListener("change", refreshArchitecturePatternOptions);
  refreshArchitecturePatternOptions();
}

// Renders the read-only "config files auto-detected" chip list under the
// source panel. `files` is an array of repo-relative paths (empty array ⇒
// "none found"); pass null to hide the block entirely (upload / paste modes,
// or before any ingest).
function renderDetectedConfig(files) {
  if (!els.detectedConfigWrap) return;
  if (files == null) {
    els.detectedConfigWrap.classList.add("hidden");
    els.detectedConfigChips.innerHTML = "";
    els.detectedConfigNote.textContent = "";
    return;
  }
  els.detectedConfigWrap.classList.remove("hidden");
  if (!files.length) {
    els.detectedConfigChips.innerHTML = "";
    els.detectedConfigNote.textContent = "No config files found in the ingested source.";
    return;
  }
  els.detectedConfigChips.innerHTML = files
    .map(
      (f) =>
        `<span class="rounded-md border border-white/15 bg-navy-deep px-2 py-1 font-mono text-[11px] text-slate-300">${esc(f)}</span>`
    )
    .join("");
  els.detectedConfigNote.textContent =
    "Found in the ingested source and included in the analysis automatically.";
}

function clearIngestedConfig() {
  ingestedConfig = "";
  ingestedConfigFiles = [];
  renderDetectedConfig(null);
}

// Calls POST /api/ingest and, on success, loads the combined source into the
// code textarea exactly as a file/folder upload would — same downstream path
// (analyze() just reads els.code.value), so nothing else needs to know the
// source was a repo clone or a local path instead of an upload.
async function ingestSource(payload, infoEl, btnEl) {
  const originalLabel = btnEl.textContent;
  btnEl.disabled = true;
  btnEl.textContent = "Ingesting…";
  infoEl.textContent = "";
  infoEl.className = "mt-1 text-[11px] text-slate-500";
  clearError();

  try {
    const res = await apiFetch("api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, language: els.language.value }),
    });
    const data = await res.json();
    if (!res.ok) {
      infoEl.textContent = data.error || "Ingestion failed.";
      infoEl.className = "mt-1 text-[11px] text-danger";
      return;
    }
    els.code.value = data.code;
    ingestedFileName = data.fileName;
    ingestedConfig = data.config || "";
    ingestedConfigFiles = Array.isArray(data.configFiles) ? data.configFiles : [];
    renderDetectedConfig(ingestedConfigFiles);
    infoEl.textContent = data.truncated
      ? `included ${data.filesIncluded} of ${data.filesTotal} matching files (capped)`
      : `included ${data.filesIncluded} of ${data.filesTotal} matching file${data.filesTotal === 1 ? "" : "s"}`;
    infoEl.className = data.truncated ? "mt-1 text-[11px] text-amber" : "mt-1 text-[11px] text-cyan/80";
  } catch {
    infoEl.textContent = "Could not reach the server.";
    infoEl.className = "mt-1 text-[11px] text-danger";
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = originalLabel;
  }
}

if (els.ingestRepoBtn) {
  els.ingestRepoBtn.addEventListener("click", () => {
    const repoUrl = els.repoUrl.value.trim();
    if (!repoUrl) {
      showError("Enter a repository URL first.");
      return;
    }
    ingestSource(
      { sourceType: "repoUrl", repoUrl, branch: els.repoBranch.value.trim() },
      $("ingestInfo-repoUrl"),
      els.ingestRepoBtn
    );
  });
}

if (els.ingestLocalBtn) {
  els.ingestLocalBtn.addEventListener("click", () => {
    const localPath = els.localPath.value.trim();
    if (!localPath) {
      showError("Enter a local folder path first.");
      return;
    }
    ingestSource(
      { sourceType: "localPath", localPath },
      $("ingestInfo-localPath"),
      els.ingestLocalBtn
    );
  });
}

function showError(msg) {
  els.inputError.textContent = msg;
  els.inputError.classList.remove("hidden");
}
function clearError() {
  els.inputError.classList.add("hidden");
}

// Four views, mutually exclusive: "form" (the New Run inputs — also the
// resting state, no separate empty-state placeholder needed), "loading"
// (a run in flight, takes over the full content area), "results", and
// "pastRuns" (the Past Runs list/detail, rendered in the main pane rather
// than a modal). Switching away from "form" hides the whole input section,
// not just a results panel next to it — "New Run" in the sidebar or "Edit
// inputs" in the results toolbar are what bring it back. inputError lives
// inside the form, so any error-path caller should land on "form", never
// "results" or "loading", or the message won't be visible.
function setView(view) {
  els.newRunForm.classList.toggle("hidden", view !== "form");
  els.loadingState.classList.toggle("hidden", view !== "loading");
  els.loadingState.classList.toggle("flex", view === "loading");
  els.results.classList.toggle("hidden", view !== "results");
  els.pastRunsView.classList.toggle("hidden", view !== "pastRuns");
  window.scrollTo(0, 0);
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

// --- AI provider / model selector (Part 5) -----------------------------------
let providerCatalog = [];

function populateModelOptions(providerId) {
  const p = providerCatalog.find((x) => x.id === providerId);
  els.aiModel.innerHTML = (p?.models || [])
    .map((m) => `<option value="${esc(m)}">${esc(m)}</option>`)
    .join("");
  updateProviderHint();
}

function updateProviderHint() {
  const p = providerCatalog.find((x) => x.id === els.aiProvider.value);
  if (!p) {
    els.providerHint.textContent = "";
    return;
  }
  els.providerHint.textContent = p.available
    ? `${p.label} is configured and ready.`
    : `${p.label} has no credentials in .env — real runs will fail, but demo mode still works.`;
  els.providerHint.className = p.available ? "mt-1 text-[11px] text-green" : "mt-1 text-[11px] text-amber";
}

async function loadProviderCatalog() {
  try {
    const res = await apiFetch("api/settings/providers");
    const body = await res.json();
    providerCatalog = body.providers || [];
    els.aiProvider.innerHTML = providerCatalog
      .map((p) => `<option value="${p.id}" ${p.available ? "" : "disabled"}>${esc(p.label)}${p.available ? "" : " (no credentials)"}</option>`)
      .join("");

    let defaultProvider = providerCatalog.find((p) => p.available)?.id || providerCatalog[0]?.id;
    let defaultModel = null;
    try {
      const defRes = await apiFetch("api/settings/default");
      const def = await defRes.json();
      if (def.defaultProvider) {
        defaultProvider = def.defaultProvider;
        defaultModel = def.defaultModel;
      }
    } catch {
      // Fall back to first-available; Settings default is a nice-to-have.
    }

    if (defaultProvider) els.aiProvider.value = defaultProvider;
    populateModelOptions(els.aiProvider.value);
    if (defaultModel) els.aiModel.value = defaultModel;
  } catch {
    els.providerHint.textContent = "Could not load provider list.";
  }
}

if (els.aiProvider) {
  els.aiProvider.addEventListener("change", () => populateModelOptions(els.aiProvider.value));
  loadProviderCatalog();
}

// If the form is showing because of "Edit inputs" (editingCurrentRun), this
// click re-assesses that run; otherwise it starts a brand-new one.
function reuseIdIfEditing() {
  const id = editingCurrentRun ? currentRunId : null;
  editingCurrentRun = false;
  return id;
}
els.analyzeBtn.addEventListener("click", () => analyze(false, reuseIdIfEditing()));
if (els.runDemoBtn) els.runDemoBtn.addEventListener("click", () => analyze(true, reuseIdIfEditing()));

async function loadSample() {
  const isJava = els.language.value === "Java";
  const codePath = isJava ? "samples/LegacyOrderService.java" : "samples/LegacyOrderService.cs";
  const codeRes = await fetch(codePath);
  if (codeRes.ok) els.code.value = await codeRes.text();
  clearIngestedConfig();
}

// Consumes an NDJSON pipeline stream (shared by /api/runs and reassess),
// forwarding "stage" events to updateStage() and returning the final result
// or error.
async function consumeNdjsonStream(res) {
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

  return { finalResult, streamError };
}

function currentRunInputs() {
  const preferredTargetLanguageEl = $("preferredTargetLanguage");
  return {
    code: els.code.value.trim(),
    config: ingestedConfig || "",
    configFiles: ingestedConfigFiles,
    fileName: combinedFileName(),
    language: els.language.value,
    targetCloud: els.targetCloud.value,
    targetArchitecturePattern: els.targetArchitecturePattern.value || null,
    plannerNotes: els.plannerNotes ? els.plannerNotes.value.trim() : "",
    provider: els.aiProvider ? els.aiProvider.value : undefined,
    model: els.aiModel ? els.aiModel.value : undefined,
    preferredMigrationType: migrationGoal === "unsure" ? null : migrationGoal === "cross-tech" ? "cross-tech" : "same-language",
    preferredTargetLanguage: migrationGoal === "cross-tech" && preferredTargetLanguageEl ? preferredTargetLanguageEl.value : null,
  };
}

// Runs Phase 1 (assessment) for a brand-new run, or — when reuseRunId is set
// — re-runs it in place against an existing run (POST .../reassess), which is
// how "Edit inputs & re-assess" works (see the Screens plan's revisioning
// rules: this always appends a new revision, never overwrites).
async function analyze(demo = false, reuseRunId = null) {
  clearError();

  if (demo && !els.code.value.trim()) {
    try {
      await loadSample();
    } catch {
      showError("Could not load the sample file for the demo.");
      return;
    }
  }

  const inputs = currentRunInputs();
  if (!inputs.code) {
    showError("Please upload, ingest, or paste a code file first.");
    return;
  }
  lastOriginalCode = inputs.code;
  currentRunInputsSnapshot = inputs;

  els.analyzeBtn.disabled = true;
  if (els.runDemoBtn) els.runDemoBtn.disabled = true;
  els.analyzeBtn.textContent = demo ? "Running demo…" : reuseRunId ? "Re-assessing…" : "Analyzing…";
  liveTokenTotal = 0;
  if (els.liveTokens) els.liveTokens.classList.add("hidden");
  if (els.liveTokenCount) els.liveTokenCount.textContent = "0";
  resetPipeline();
  setView("loading");

  try {
    const url = reuseRunId ? `api/runs/${reuseRunId}/reassess` : "api/runs";
    const res = await apiFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...inputs, demo }),
    });

    // Pre-stream errors (missing key, no code, locked run) come back as plain JSON.
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showError(data.error || "Assessment failed.");
      setView("form");
      return;
    }

    const { finalResult, streamError } = await consumeNdjsonStream(res);

    if (streamError) {
      showError(streamError);
      setView("form");
    } else if (finalResult) {
      currentRunId = finalResult.runId;
      currentRevision = finalResult.revision;
      currentRunStatus = "pending_gate_a";
      isDemoRun = demo;
      render(finalResult);
      setView("results");
    } else {
      showError("The pipeline did not return a result. Please try again.");
      setView("form");
    }
  } catch (err) {
    showError("Could not reach the local server. Is it still running?");
    setView("form");
  } finally {
    els.analyzeBtn.disabled = false;
    if (els.runDemoBtn) els.runDemoBtn.disabled = false;
    els.analyzeBtn.textContent = "Start Assessment →";
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
// The status stamp/watermark a report should carry, reflecting where the
// run actually is right now (module-level currentRunStatus, not just what
// fields happen to be present in `data`).
function reportStatusStamp(data) {
  if (currentRunStatus === "stopped") return "STOPPED AT ASSESSMENT — no code was generated.";
  if (currentRunStatus === "rejected") return "REJECTED at Gate B — not approved for use.";
  if (currentRunStatus === "approved") {
    const d = data.gateBDecision;
    const when = d && d.decidedAt ? new Date(d.decidedAt).toISOString().slice(0, 10) : "";
    return `APPROVED by ${(d && d.decidedByRole) || "architect"}${when ? ` on ${when}` : ""}.`;
  }
  if (currentRunStatus === "pending_gate_b") return "PENDING APPROVAL (Gate B).";
  if (currentRunStatus === "pending_gate_a") return "PENDING GATE A REVIEW.";
  return "—";
}

function buildReportMarkdown(data) {
  const summary = data.summary || {};
  const risk = data.riskSummary || {};
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const breakdown = Array.isArray(data.scoreBreakdown) ? data.scoreBreakdown : [];
  const date = new Date().toISOString().slice(0, 10);
  const L = [];

  L.push(`# ShiftWise Migration Report — ${summary.fileName || "Analysis"}`);
  L.push("");
  L.push(`_Generated ${date} by ShiftWise Transformation Platform._`);
  L.push("");
  L.push(`**Status: ${reportStatusStamp(data)}**`);
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
  if (data.recommendedStrategy) {
    L.push("## AI Recommendation");
    L.push("");
    L.push(`- **Strategy:** ${data.recommendedStrategy}`);
    L.push(
      `- **Migration type:** ${data.migrationType === "cross-tech" ? `Cross-Tech → ${data.targetLanguage || "?"}` : "Cloud Readiness Modernization (same language)"}`
    );
    L.push(`- **Target architecture:** ${data.targetArchitecture || "—"}`);
    L.push("");
    if (data.strategyJustification) {
      L.push(data.strategyJustification);
      L.push("");
    }
  }
  if (Array.isArray(data.dependencies) && data.dependencies.length) {
    L.push("## Dependencies");
    L.push("");
    if (data.dependencySummary) {
      L.push(data.dependencySummary);
      L.push("");
    }
    L.push("| Reference | Category | Risk | Note |");
    L.push("| --- | --- | --- | --- |");
    data.dependencies.forEach((d) =>
      L.push(`| ${d.reference} | ${d.category} | ${d.risk || "—"} | ${String(d.note || "").replace(/\|/g, "\\|")} |`)
    );
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
  if (Array.isArray(data.translationAssumptions) && data.translationAssumptions.length) {
    L.push("## Translation assumptions");
    L.push("");
    data.translationAssumptions.forEach((a) => L.push(`- ${a}`));
    L.push("");
  }
  if (Array.isArray(data.findingResolutions) && data.findingResolutions.length) {
    L.push("## Validation");
    L.push("");
    L.push(`**Manual review recommended:** ${data.manualReviewRecommended ? "Yes" : "No"}`);
    L.push("");
    if (data.validationSummary) {
      L.push(data.validationSummary);
      L.push("");
    }
    L.push("| Finding | Resolved | Note |");
    L.push("| --- | --- | --- |");
    const findingById = Object.fromEntries(findings.map((f) => [f.id, f]));
    data.findingResolutions.forEach((r) => {
      const f = findingById[r.findingId];
      L.push(`| ${(f && f.title) || r.findingId} | ${r.resolved ? "Yes" : "No"} | ${String(r.note || "").replace(/\|/g, "\\|")} |`);
    });
    L.push("");
    if (Array.isArray(data.staticChecks) && data.staticChecks.length) {
      L.push("| Static check | Passed |");
      L.push("| --- | --- |");
      data.staticChecks.forEach((c) => L.push(`| ${c.check} | ${c.passed ? "Yes" : "No"} |`));
      L.push("");
    }
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
  a.download = `shiftwise-migration-${safe}.md`;
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

  // Dependencies (Dependency Analysis agent).
  const dependencies = Array.isArray(data.dependencies) ? data.dependencies : null;
  let dependenciesSection = "";
  if (dependencies) {
    const depRisk = { High: SEVERITY.High, Medium: SEVERITY.Medium, Low: SEVERITY.Low, None: SEVERITY.Low };
    dependenciesSection = `
      ${data.dependencySummary ? `<p class="text-sm leading-relaxed text-slate-300">${esc(data.dependencySummary)}</p>` : ""}
      <div class="flex flex-wrap gap-2 font-mono text-[11px]">
        <span class="rounded border border-white/15 bg-white/5 px-2 py-1 text-slate-300">${data.externalDependencyCount ?? 0} external</span>
        <span class="rounded border border-white/15 bg-white/5 px-2 py-1 text-slate-300">${data.internalDependencyCount ?? 0} internal</span>
      </div>
      ${
        dependencies.length
          ? `<div class="mt-3 space-y-2">${dependencies
              .map((d) => {
                const s = depRisk[d.risk] || SEVERITY.Low;
                return `
                <div class="rounded-lg border ${s.border} ${s.bg} p-3">
                  <div class="flex items-center justify-between gap-3">
                    <span class="font-mono text-sm text-slate-100">${esc(d.reference)}</span>
                    <span class="shrink-0 rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${s.text} ${s.bg}">${esc(d.risk || "—")} risk</span>
                  </div>
                  <div class="mt-1 font-mono text-[11px] text-slate-500">${esc(d.category)}</div>
                  ${d.note ? `<p class="mt-1 text-sm leading-relaxed text-slate-300">${esc(d.note)}</p>` : ""}
                </div>`;
              })
              .join("")}</div>`
          : `<div class="mt-3 rounded-lg border border-green/30 bg-green/10 p-4 text-sm text-green">No import/using-style references were found.</div>`
      }`;
  }

  // Strategy (Strategy Planner agent's recommendation — reviewed at Gate A,
  // not yet acted on).
  const migrationTypeLabel = (type, targetLang) =>
    type === "cross-tech" ? `Cross-Tech Migration → ${esc(targetLang || "?")}` : "Cloud Readiness (same language)";
  const statedGoalMismatch =
    data.preferredMigrationType && data.preferredMigrationType !== data.migrationType;
  const statedGoalRow = data.preferredMigrationType
    ? `<div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span class="font-mono text-[10px] uppercase tracking-wider text-slate-500">Your stated goal:</span>
        <span class="rounded border border-white/15 bg-white/5 px-2 py-1 font-mono text-[11px] text-slate-300">${migrationTypeLabel(data.preferredMigrationType, data.preferredTargetLanguage)}</span>
        ${statedGoalMismatch ? `<span class="rounded border border-amber/30 bg-amber/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-amber">AI recommends differently — see below</span>` : ""}
      </div>`
    : "";
  const strategySection = `
    <div class="rounded-lg border border-cyan/20 bg-navy-panel/60 p-5">
      <div class="font-mono text-xs uppercase tracking-[0.2em] text-cyan/70">AI Recommendation (pending Gate A review)</div>
      <div class="mt-3 flex flex-wrap gap-2 font-mono text-[11px]">
        <span class="rounded border border-cyan/30 bg-cyan/10 px-2 py-1 text-cyan">${esc(data.recommendedStrategy || "—")}</span>
        <span class="rounded border border-white/15 bg-white/5 px-2 py-1 text-slate-300">${migrationTypeLabel(data.migrationType, data.targetLanguage)}</span>
      </div>
      ${statedGoalRow}
      <p class="mt-3 text-sm leading-relaxed text-slate-300">${esc(data.strategyJustification || "")}</p>
      <div class="mt-3 rounded-md border border-white/10 bg-navy-deep/50 p-3">
        <div class="font-mono text-[10px] uppercase tracking-wider text-slate-500">Recommended target architecture</div>
        <p class="mt-1 text-sm text-slate-100">${esc(data.targetArchitecture || "—")}</p>
      </div>
    </div>`;

  // Tabs: only include sections that have content.
  const tabs = [
    { id: "overview", label: "Overview", content: overview },
    { id: "strategy", label: "Strategy", content: strategySection },
    { id: "findings", label: `Findings (${findings.length})`, content: findingsSection },
  ];
  if (dependencies) {
    tabs.push({ id: "dependencies", label: `Dependencies (${dependencies.length})`, content: dependenciesSection });
  }
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
  if (Array.isArray(data.findingResolutions)) {
    tabs.push({ id: "validation", label: "Validation", content: validationSection(data, findings) });
  }
  if (data.telemetry && Array.isArray(data.telemetry.stages) && data.telemetry.stages.length) {
    tabs.push({ id: "stats", label: "Run Stats", content: statsPanel(data.telemetry) });
  }

  const tabBtn = (t, active) =>
    `<button data-tab="${t.id}" class="-mb-px shrink-0 border-b-2 px-4 py-2 font-mono text-[11px] uppercase tracking-wider transition ${
      active ? "border-cyan text-cyan" : "border-transparent text-slate-400 hover:text-slate-200"
    }">${t.label}</button>`;

  let html = "";

  // Results toolbar — export the analysis as a Markdown report, and (while a
  // run is still pending Gate A) edit inputs before re-assessing. "Edit
  // inputs" only reveals the form for editing — analyze() isn't called until
  // Start Assessment / Run demo is clicked again (editRunInputs, in app.js).
  html += `
    <div class="flex items-center justify-between gap-2">
      <div class="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Analysis results</div>
      <div class="flex gap-2">
        ${
          data.recommendedStrategy && currentRunStatus === "pending_gate_a"
            ? `<button id="reassessBtn" class="rounded-md border border-white/20 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-slate-300 transition hover:bg-white/5">
                ✎ Edit inputs
              </button>`
            : ""
        }
        ${
          currentRunStatus && currentRunStatus !== "pending_gate_a"
            ? `<button id="duplicateRunBtn" class="rounded-md border border-white/20 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-slate-300 transition hover:bg-white/5">
                ⧉ Duplicate as new run
              </button>`
            : ""
        }
        <button id="exportReportBtn" class="rounded-md border border-cyan/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-cyan transition hover:bg-cyan/10">
          ↓ Download report (.md)
        </button>
      </div>
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

  // Gate panel: which one (if any) depends on where this run actually is —
  // not just what fields happen to be present, since a re-render after
  // Gate A proceeds carries both assessment AND transformation data at once.
  if (currentRunStatus === "pending_gate_a" && data.recommendedStrategy) {
    html += gateAPanelHtml(data);
  } else if (currentRunStatus === "pending_gate_b" && data.modernizedCode) {
    html += gateBPanelHtml(data);
  } else if (["stopped", "approved", "rejected"].includes(currentRunStatus)) {
    html += finalStatusBannerHtml(currentRunStatus, data);
  }

  els.results.innerHTML = html;

  const reassessBtn = document.getElementById("reassessBtn");
  if (reassessBtn) {
    reassessBtn.addEventListener("click", editRunInputs);
  }
  const duplicateRunBtn = document.getElementById("duplicateRunBtn");
  if (duplicateRunBtn) {
    duplicateRunBtn.addEventListener("click", duplicateAsNewRun);
  }

  if (currentRunStatus === "pending_gate_a" && data.recommendedStrategy) {
    wireGateA(data);
  } else if (currentRunStatus === "pending_gate_b" && data.modernizedCode) {
    wireGateB(data);
  }

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

const TARGET_LANGUAGE_OPTIONS = [".NET", "Java", "COBOL", "VB6 / VB.NET", "PHP", "Python"];

// Gate A panel: the recommended values pre-fill explicit controls (dropdowns)
// that are always what actually gets submitted — the optional chat below can
// only ever *suggest* values into those same controls via "Apply to form",
// never submit a decision on its own.
function gateAPanelHtml(data) {
  const migrationType = data.migrationType === "cross-tech" ? "cross-tech" : "same-language";
  const targetLanguage = data.targetLanguage || TARGET_LANGUAGE_OPTIONS.find((l) => l !== els.language.value) || "Java";
  const archPattern = els.targetArchitecturePattern.value || "Containers";

  return `
    <div id="gateAPanel" class="rounded-lg border border-cyan/30 bg-navy-panel/60 p-5">
      <div class="flex items-center justify-between">
        <div class="font-mono text-xs uppercase tracking-[0.2em] text-cyan/70">Gate A — Review &amp; Decide</div>
        <span class="rounded border border-white/15 bg-white/5 px-2 py-1 font-mono text-[10px] text-slate-400">requires Architect role</span>
      </div>

      <div id="gateAStatus" class="mt-3"></div>

      <div id="gateAControls" class="mt-4 space-y-4">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label class="block text-xs font-medium text-slate-300">Migration type</label>
            <select id="gateMigrationType" class="mt-1 w-full rounded-md border border-white/15 bg-navy-deep px-3 py-2 text-sm focus:border-cyan focus:outline-none">
              <option value="same-language" ${migrationType === "same-language" ? "selected" : ""}>Cloud Readiness Modernization (same language)</option>
              <option value="cross-tech" ${migrationType === "cross-tech" ? "selected" : ""}>Cross-Tech Migration (rewrite to a different language)</option>
            </select>
          </div>
          <div id="gateTargetLanguageWrap" class="${migrationType === "cross-tech" ? "" : "hidden"}">
            <label class="block text-xs font-medium text-slate-300">Target language</label>
            <select id="gateTargetLanguage" class="mt-1 w-full rounded-md border border-white/15 bg-navy-deep px-3 py-2 text-sm focus:border-cyan focus:outline-none">
              ${TARGET_LANGUAGE_OPTIONS.filter((l) => l !== els.language.value)
                .map((l) => `<option value="${esc(l)}" ${l === targetLanguage ? "selected" : ""}>${esc(l)}</option>`)
                .join("")}
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-300">Target architecture pattern</label>
            <select id="gateArchPattern" class="mt-1 w-full rounded-md border border-white/15 bg-navy-deep px-3 py-2 text-sm focus:border-cyan focus:outline-none">
              ${["Containers", "PaaS", "Serverless"].map((p) => `<option value="${p}" ${p === archPattern ? "selected" : ""}>${p}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="rounded-md border border-white/10 bg-navy-deep/40 p-3">
          <button id="toggleChatBtn" type="button" class="font-mono text-[11px] uppercase tracking-wider text-cyan/80 hover:text-cyan">
            💬 Discuss with AI ${data.recommendedStrategy ? "(optional)" : ""}
          </button>
          <div id="chatPanel" class="mt-3 hidden space-y-3">
            <div id="chatMessages" class="max-h-64 space-y-2 overflow-y-auto"></div>
            <div class="flex gap-2">
              <input id="chatInput" type="text" placeholder="e.g. we're an AWS shop, avoid a rewrite" class="flex-1 rounded-md border border-white/15 bg-navy-deep px-3 py-2 text-sm focus:border-cyan focus:outline-none" />
              <button id="chatSendBtn" class="shrink-0 rounded-md border border-cyan/40 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-cyan transition hover:bg-cyan/10">Send</button>
            </div>
          </div>
        </div>

        <div class="flex gap-3">
          <button id="gateProceedBtn" class="flex-1 rounded-md bg-cyan px-4 py-2.5 font-semibold text-navy-deep transition hover:bg-cyan/90">
            Confirm &amp; proceed
          </button>
          <button id="gateStopBtn" class="flex-1 rounded-md border border-white/20 px-4 py-2.5 font-semibold text-slate-200 transition hover:bg-white/5">
            Stop here
          </button>
        </div>
        <p class="text-[11px] text-slate-500">
          "Stop here" is a legitimate outcome — no code is generated. Switch to the Architect role in the header to act on this gate.
        </p>
      </div>
    </div>`;
}

function chatBubble(entry) {
  const isUser = entry.role === "user";
  return `
    <div class="flex ${isUser ? "justify-end" : "justify-start"}">
      <div class="max-w-[85%] rounded-lg border ${isUser ? "border-cyan/30 bg-cyan/10" : "border-white/10 bg-navy-deep/60"} p-2.5 text-sm leading-relaxed text-slate-200">
        ${esc(entry.content)}
      </div>
    </div>`;
}

function wireGateA(data) {
  refreshGateButtonsForRole();
  const migrationTypeSel = document.getElementById("gateMigrationType");
  const targetLanguageWrap = document.getElementById("gateTargetLanguageWrap");
  const archPatternSel = document.getElementById("gateArchPattern");
  const statusEl = document.getElementById("gateAStatus");
  const controlsEl = document.getElementById("gateAControls");

  migrationTypeSel.addEventListener("change", () => {
    targetLanguageWrap.classList.toggle("hidden", migrationTypeSel.value !== "cross-tech");
  });

  // --- Optional "Discuss with AI" chat -----------------------------------
  const toggleChatBtn = document.getElementById("toggleChatBtn");
  const chatPanel = document.getElementById("chatPanel");
  const chatMessages = document.getElementById("chatMessages");
  const chatInput = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");

  toggleChatBtn.addEventListener("click", () => chatPanel.classList.toggle("hidden"));

  function applyToForm(suggestion) {
    if (suggestion.suggestedMigrationType) {
      migrationTypeSel.value = suggestion.suggestedMigrationType;
      targetLanguageWrap.classList.toggle("hidden", suggestion.suggestedMigrationType !== "cross-tech");
    }
    if (suggestion.suggestedTargetLanguage) {
      const gateTargetLanguage = document.getElementById("gateTargetLanguage");
      if (gateTargetLanguage) gateTargetLanguage.value = suggestion.suggestedTargetLanguage;
    }
    if (suggestion.suggestedTargetArchitecturePattern) {
      archPatternSel.value = suggestion.suggestedTargetArchitecturePattern;
    }
  }

  async function sendChatMessage() {
    const message = chatInput.value.trim();
    if (!message || !currentRunId) return;
    chatMessages.insertAdjacentHTML("beforeend", chatBubble({ role: "user", content: message }));
    chatInput.value = "";
    chatInput.disabled = true;
    chatSendBtn.disabled = true;
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
      const res = await apiFetch(`api/runs/${currentRunId}/strategy-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, demo: isDemoRun }),
      });
      const reply = await res.json();
      if (!res.ok) {
        chatMessages.insertAdjacentHTML(
          "beforeend",
          `<p class="text-xs text-danger">${esc(reply.error || "Chat failed.")}</p>`
        );
        return;
      }
      const bubbleId = `chat-suggestion-${Date.now()}`;
      chatMessages.insertAdjacentHTML(
        "beforeend",
        `<div>${chatBubble({ role: "assistant", content: reply.reply })}
          <div class="mt-1 flex justify-start">
            <button id="${bubbleId}" class="font-mono text-[10px] uppercase tracking-wider text-cyan/70 hover:text-cyan">↳ Apply to form</button>
          </div>
        </div>`
      );
      const applyBtn = document.getElementById(bubbleId);
      if (applyBtn) applyBtn.addEventListener("click", () => applyToForm(reply));
      chatMessages.scrollTop = chatMessages.scrollHeight;
    } catch {
      chatMessages.insertAdjacentHTML(
        "beforeend",
        `<p class="text-xs text-danger">Could not reach the server.</p>`
      );
    } finally {
      chatInput.disabled = false;
      chatSendBtn.disabled = false;
      chatInput.focus();
    }
  }

  chatSendBtn.addEventListener("click", sendChatMessage);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChatMessage();
  });

  // --- Confirm & proceed / Stop here --------------------------------------
  function showGateStatus(html, tone) {
    const toneClass = tone === "danger" ? "border-danger/40 bg-danger/10 text-danger" : tone === "warn" ? "border-amber/40 bg-amber/10 text-amber" : "border-green/40 bg-green/10 text-green";
    statusEl.innerHTML = `<div class="rounded-md border ${toneClass} p-3 text-sm leading-relaxed">${html}</div>`;
  }

  document.getElementById("gateStopBtn").addEventListener("click", async () => {
    if (!currentRunId) return;
    try {
      const res = await apiFetch(`api/runs/${currentRunId}/gate-a`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const body = await res.json();
      if (!res.ok) {
        showGateStatus(esc(body.error || "Could not stop the run."), "danger");
        return;
      }
      currentRunStatus = "stopped";
      // Re-render (matching gateProceed/gateApprove/gateReject below) so the
      // results toolbar picks up the status change too — e.g. swaps "Edit
      // inputs" for "Duplicate as new run" now that inputs are locked.
      render({ ...data });
    } catch {
      showGateStatus("Could not reach the server.", "danger");
    }
  });

  const TRANSFORM_STAGES = [
    { key: "modernize", label: "Transformation agent", desc: "Generating modernized code & cloud config" },
    { key: "validate", label: "Validation agent", desc: "Checking findings resolved & running static checks" },
  ];

  function inlineProgressHtml() {
    return TRANSFORM_STAGES.map(
      (s) => `
      <div id="txstage-${s.key}" class="flex items-start gap-3 rounded-md border border-white/10 bg-navy-deep/40 p-3 opacity-50 transition">
        <div id="txstage-icon-${s.key}" class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/20 font-mono text-[10px] text-slate-500">•</div>
        <div class="flex-1">
          <div class="text-sm font-medium text-slate-200">${s.label}</div>
          <div id="txstage-desc-${s.key}" class="font-mono text-[11px] leading-snug text-slate-500">${s.desc}</div>
        </div>
      </div>`
    ).join("");
  }

  function updateInlineStage(evt) {
    const row = document.getElementById(`txstage-${evt.stage}`);
    const icon = document.getElementById(`txstage-icon-${evt.stage}`);
    if (!row || !icon) return;
    if (evt.status === "start") {
      row.classList.remove("opacity-50");
      row.classList.add("border-cyan/40", "bg-cyan/5");
      icon.className = "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-cyan/40 border-t-cyan animate-spin";
      icon.textContent = "";
    } else if (evt.status === "done") {
      row.classList.remove("opacity-50", "border-cyan/40", "bg-cyan/5");
      row.classList.add("border-green/40", "bg-green/5");
      icon.className = "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green/20 font-mono text-[11px] text-green";
      icon.textContent = "✓";
    }
  }

  document.getElementById("gateProceedBtn").addEventListener("click", async () => {
    if (!currentRunId) return;
    const migrationType = migrationTypeSel.value;
    const targetLanguage = migrationType === "cross-tech" ? document.getElementById("gateTargetLanguage").value : null;
    const targetArchitecturePattern = archPatternSel.value;

    controlsEl.innerHTML = `<div class="space-y-3">${inlineProgressHtml()}</div>`;
    statusEl.innerHTML = "";

    try {
      const res = await apiFetch(`api/runs/${currentRunId}/gate-a`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "proceed", migrationType, targetLanguage, targetArchitecturePattern, demo: isDemoRun }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showGateStatus(esc(body.error || "Could not proceed."), "danger");
        controlsEl.innerHTML = "";
        return;
      }

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
          if (evt.type === "stage") updateInlineStage(evt);
          else if (evt.type === "result") finalResult = evt.data;
          else if (evt.type === "error") streamError = evt.error;
        }
      }

      if (streamError) {
        showGateStatus(esc(streamError), "danger");
        controlsEl.innerHTML = "";
        return;
      }
      if (!finalResult) {
        showGateStatus("The transformation did not return a result. Please try again.", "danger");
        controlsEl.innerHTML = "";
        return;
      }

      currentRunStatus = "pending_gate_b";
      // Merge Phase 1 (assessment) + Phase 2 (transformation) and re-render —
      // render() already knows how to add Modernized Code / Cloud Config /
      // Validation tabs and swap in the Gate B panel based on currentRunStatus.
      render({ ...data, ...finalResult });
    } catch {
      showGateStatus("Could not reach the server.", "danger");
      controlsEl.innerHTML = "";
    }
  });
}

// Validation tab: per-finding resolved/unresolved, deterministic static
// checks, structural parity (cross-tech only), and translation assumptions.
function validationSection(data, findings) {
  const findingById = Object.fromEntries((findings || []).map((f) => [f.id, f]));
  const resolutions = Array.isArray(data.findingResolutions) ? data.findingResolutions : [];
  const checks = Array.isArray(data.staticChecks) ? data.staticChecks : [];
  const parity = data.structuralParity;
  const assumptions = Array.isArray(data.translationAssumptions) ? data.translationAssumptions : [];

  const manualReviewBanner = data.manualReviewRecommended
    ? `<div class="rounded-lg border border-amber/40 bg-amber/10 p-4">
        <div class="font-mono text-xs uppercase tracking-[0.2em] text-amber">⚠ Manual review strongly recommended</div>
        <p class="mt-2 text-sm leading-relaxed text-slate-200">${esc(data.validationSummary || "")}</p>
      </div>`
    : `<div class="rounded-lg border border-green/30 bg-green/10 p-4">
        <div class="font-mono text-xs uppercase tracking-[0.2em] text-green">Validation passed</div>
        <p class="mt-2 text-sm leading-relaxed text-slate-200">${esc(data.validationSummary || "")}</p>
      </div>`;

  const resolutionsHtml = resolutions.length
    ? `<div class="space-y-2">
        ${resolutions
          .map((r) => {
            const f = findingById[r.findingId];
            const style = r.resolved ? "border-green/30 bg-green/10 text-green" : "border-danger/30 bg-danger/10 text-danger";
            return `
            <div class="rounded-lg border ${r.resolved ? "border-green/20 bg-green/5" : "border-danger/20 bg-danger/5"} p-3">
              <div class="flex items-center justify-between gap-3">
                <span class="text-sm text-slate-100">${esc((f && f.title) || r.findingId)}</span>
                <span class="shrink-0 rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider border ${style}">${r.resolved ? "Resolved" : "Not resolved"}</span>
              </div>
              ${r.note ? `<p class="mt-1 text-sm leading-relaxed text-slate-300">${esc(r.note)}</p>` : ""}
            </div>`;
          })
          .join("")}
      </div>`
    : "";

  const checksHtml = checks.length
    ? `<div>
        <div class="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-slate-300">Static checks</div>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          ${checks
            .map(
              (c) => `
            <div class="flex items-center gap-2 rounded-md border ${c.passed ? "border-green/20 bg-green/5" : "border-danger/20 bg-danger/5"} p-2.5 text-sm">
              <span class="${c.passed ? "text-green" : "text-danger"}">${c.passed ? "✓" : "✗"}</span>
              <span class="text-slate-200">${esc(c.check)}</span>
            </div>`
            )
            .join("")}
        </div>
      </div>`
    : "";

  const parityHtml = parity
    ? `<div class="rounded-md border border-white/10 bg-navy-deep/50 p-3 text-sm text-slate-300">
        <span class="font-mono text-[11px] uppercase tracking-wider text-slate-500">Structural parity: </span>
        ${parity.originalDeclarationCount} → ${parity.modernizedDeclarationCount} declarations
        (${parity.withinExpectedRange ? "within expected range" : "outside expected range"})
      </div>`
    : "";

  const assumptionsHtml = assumptions.length
    ? `<div>
        <div class="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-slate-300">Translation assumptions</div>
        <ul class="space-y-2">
          ${assumptions.map((a) => `<li class="rounded-md border border-white/10 bg-navy-deep/40 p-2.5 text-sm leading-relaxed text-slate-300">${esc(a)}</li>`).join("")}
        </ul>
      </div>`
    : "";

  return [manualReviewBanner, checksHtml, parityHtml, assumptionsHtml, resolutionsHtml].filter(Boolean).join("");
}

// Gate B panel: final human sign-off on the transformation output.
function gateBPanelHtml() {
  return `
    <div id="gateBPanel" class="rounded-lg border border-cyan/30 bg-navy-panel/60 p-5">
      <div class="flex items-center justify-between">
        <div class="font-mono text-xs uppercase tracking-[0.2em] text-cyan/70">Gate B — Final Sign-off</div>
        <span class="rounded border border-white/15 bg-white/5 px-2 py-1 font-mono text-[10px] text-slate-400">requires Architect role</span>
      </div>
      <div id="gateBStatus" class="mt-3"></div>
      <div id="gateBControls" class="mt-4 space-y-3">
        <label class="block text-xs font-medium text-slate-300">Comment (optional)</label>
        <textarea id="gateBComment" rows="2" placeholder="Notes for the record…" class="w-full resize-y rounded-md border border-white/15 bg-navy-deep px-3 py-2 text-sm focus:border-cyan focus:outline-none"></textarea>
        <div class="flex gap-3">
          <button id="gateApproveBtn" class="flex-1 rounded-md bg-cyan px-4 py-2.5 font-semibold text-navy-deep transition hover:bg-cyan/90">Approve</button>
          <button id="gateRejectBtn" class="flex-1 rounded-md border border-danger/40 px-4 py-2.5 font-semibold text-danger transition hover:bg-danger/10">Reject</button>
        </div>
      </div>
    </div>`;
}

function wireGateB(data) {
  refreshGateButtonsForRole();
  const statusEl = document.getElementById("gateBStatus");
  const controlsEl = document.getElementById("gateBControls");
  const commentEl = document.getElementById("gateBComment");

  function showStatus(html, tone) {
    const toneClass = tone === "danger" ? "border-danger/40 bg-danger/10 text-danger" : "border-green/40 bg-green/10 text-green";
    statusEl.innerHTML = `<div class="rounded-md border ${toneClass} p-3 text-sm leading-relaxed">${html}</div>`;
  }

  async function decide(action) {
    if (!currentRunId) return;
    try {
      const res = await apiFetch(`api/runs/${currentRunId}/gate-b`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment: commentEl.value.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        showStatus(esc(body.error || "Could not decide Gate B."), "danger");
        return;
      }
      currentRunStatus = body.status;
      render({ ...data });
    } catch {
      showStatus("Could not reach the server.", "danger");
    }
  }

  document.getElementById("gateApproveBtn").addEventListener("click", () => decide("approve"));
  document.getElementById("gateRejectBtn").addEventListener("click", () => decide("reject"));
}

// Read-only banner for a run that's already reached a final state (stopped
// at Gate A, or approved/rejected at Gate B) — used both right after a
// decision and when reopening a past run from the Past Runs list.
function finalStatusBannerHtml(status, data) {
  const byStatus = {
    stopped: { tone: "border-amber/40 bg-amber/10 text-amber", label: "STOPPED AT ASSESSMENT", detail: "No code was generated for this run." },
    approved: { tone: "border-green/40 bg-green/10 text-green", label: "APPROVED", detail: "This artifact is signed off." },
    rejected: { tone: "border-danger/40 bg-danger/10 text-danger", label: "REJECTED", detail: "This artifact was not approved." },
  };
  const s = byStatus[status] || byStatus.stopped;
  const comment = data.gateBDecision && data.gateBDecision.comment;
  return `
    <div class="rounded-lg border ${s.tone} p-4">
      <div class="font-mono text-xs uppercase tracking-[0.2em]">${s.label}</div>
      <p class="mt-1 text-sm leading-relaxed">${s.detail}</p>
      ${comment ? `<p class="mt-2 text-sm leading-relaxed text-slate-300">"${esc(comment)}"</p>` : ""}
    </div>`;
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
