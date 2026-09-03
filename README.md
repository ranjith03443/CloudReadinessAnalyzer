# ShiftWise — Transformation Platform

An AI-powered tool that assesses a legacy codebase's cloud readiness, recommends a migration strategy, and — once a human signs off — generates a modernized, cloud-ready rewrite. It's a working prototype of the ideas in the ShiftWise pitch deck: a two-phase, multi-agent migration pipeline with a human approval gate before any code is touched, and a second gate before anything is called "done."

It runs **entirely on your own machine**. Your code and API key never leave it except for the calls to whichever AI provider you configure.

### What it does

1. **Ingest** a codebase — upload files, point it at a public git repository URL (it clones locally, deletes the clone when done), or a local folder path already on disk.
2. **Assess** it with 5 specialized agents (Code Intelligence, Dependency Analysis, Strategy Planner, Scoring/Risk, Estimation) — no code is generated yet. You get a cloud readiness score, categorized findings, a dependency risk breakdown, a recommended migration strategy, and an effort estimate.
3. **Decide at Gate A** — accept the AI's recommendation, override it, negotiate it via an optional chat with the Strategy Planner, or stop here with no code touched (a legitimate outcome, especially if the recommendation is Retain/Retire).
4. **Transform**, if you proceeded — 2 more agents (Transformation, Validation) produce the modernized code, cloud-ready config, and a validation report checking whether the original findings were actually resolved.
5. **Approve at Gate B** — the final human sign-off, with a comment, before the artifact is considered done.

Every step is logged to an audit trail, and every individual AI call is tracked in a cost ledger you can filter by date or run.

### Source & target scope

- **Source languages:** .NET (C#), Java, COBOL, VB6/VB.NET, PHP, Python. .NET and Java have the deepest validation coverage; the rest are supported via the same AI reasoning, just less battle-tested.
- **Target cloud:** Azure, AWS, or GCP, with a Containers/PaaS/Serverless architecture pattern (or let the AI recommend one).
- **Migration type:** modernize in place (same language) or a cross-tech rewrite into a different language — the Strategy Planner recommends which, and flags when it disagrees with what you picked.
- **AI provider:** OpenAI, Azure OpenAI, or Claude (Anthropic) — configure whichever you have credentials for; pick per-run or set a default in Settings.

---

## How it works: two LangGraph pipelines, not one big prompt

Analysis and code generation are deliberately two separate graphs, run at two separate times — that split is what makes "stop after assessment, no code touched" and "AI recommends, human confirms before anything is generated" possible at all.

### Phase 1 — Assessment (`agents/assessmentPipeline.js`)

```
START ─┬─▶ detect ─┬─▶ score ─────────────┐
       │           └─▶ strategize ─▶ estimate ─▶ END
       └─▶ dependency ─┘
```

- **Code Intelligence** (`detector.js`) and **Dependency Analysis** (`dependency.js`) run in parallel from START — Dependency Analysis does real static extraction of import/using-style references (regex-based, not an LLM guess) before an LLM pass adds risk commentary over what was actually found.
- **Strategy Planner** (`strategist.js`) waits on both, and recommends a 6R strategy (Rehost/Replatform/Refactor/Rebuild/Retire/Retain), a migration type, and a target architecture — a recommendation for Gate A to confirm, not something it acts on itself. It also has a conversational mode used by Gate A's optional "Discuss with AI" chat.
- **Scoring/Risk** (`scorer.js`) only needs Code Intelligence's findings.
- **Estimation** (`estimator.js`) waits on the Strategy Planner's recommendation, since a cross-tech rewrite is sized very differently from a same-language modernization of the same code.

### Phase 2 — Transformation (`agents/transformPipeline.js`)

```
START ─▶ modernize ─▶ validate ─▶ END
```

- **Transformation** (`modernizer.js`) branches its prompt on the confirmed migration type: same-language modernization, or a cross-tech logic translation that's required to list its own assumptions rather than silently guess.
- **Validation** (`validator.js`) runs deterministic static checks first (brace balance, leftover-secret scan, TODO markers, and — for cross-tech — a structural parity check), then an LLM pass judging whether each *original* finding is actually resolved. Manual review is force-flagged for any cross-tech run or failed static check, not left to the model's discretion.

Every node emits stage events streamed live to the browser. If an agent returns something that doesn't match its expected shape, the node throws and the graph surfaces one clean error instead of a corrupted result.

### Why 7 agents and not the deck's 8

The deck also names a DevOps Agent and a Monitoring Agent. Both are post-cutover/operate-phase concerns — CI/CD pipeline execution, drift detection — that don't fit a pre-migration readiness tool, so they're deliberately not built here rather than stubbed out for the sake of the count.

---

## Governance

- **Two human approval gates** — Gate A (proceed to code generation, or stop) and Gate B (approve or reject the final artifact) — both logged to the audit trail with who decided what and when.
- **Role switcher, not a login.** There's no authentication in this prototype — a header toggle lets you act as `architect` (can decide both gates, view the audit log, cost ledger, and settings) or `viewer` (read-only). This is explicitly **not access control**: anyone using the app can flip the toggle. It exists to demonstrate the RBAC/governance *concept* without login friction. Gate/audit/cost/settings routes are still enforced server-side regardless of what the UI shows — flip the role and the buttons themselves disable, not just the eventual request. Real credential-backed auth is a Pilot-phase item.
- **Audit log** — every ingestion, assessment, reassessment, gate decision, and settings change is recorded (`GET /api/audit`, architect-only).
- **Cost ledger** — every individual AI call (not just a per-run rollup) is recorded with its provider, model, tokens, and estimated cost, filterable by date range or run (`GET /api/cost`, architect-only).
- **Read-only discovery.** Analysis never writes to the ingested source — true by construction here, since there's no source-control write-back at all, not because of an access-control layer enforcing it.

None of this is enterprise-grade — no SSO, no secrets manager, no compliance certification. It's a lightweight, honest stand-in for what those would do, scoped to what a prototype can credibly demonstrate.

---

## Requirements

- **Node.js 18 or newer** — download from <https://nodejs.org> (the LTS installer is fine).
- **Git** — required only if you use the Repository URL ingestion mode (server-side `git clone`).
- An API key for **at least one** of: OpenAI, Azure OpenAI, or Anthropic (Claude). None are required to try demo mode.

To check Node is installed:

```powershell
node -v
```

---

## Setup on Windows (step by step)

1. **Get the folder** onto your PC and open a terminal in it (in File Explorer, click the address bar, type `powershell`, press Enter).

2. **Install dependencies** (only needed the first time):

   ```powershell
   npm install
   ```

3. **Add credentials for at least one AI provider.** Copy the example env file and edit it:

   ```powershell
   copy .env.example .env
   notepad .env
   ```

   Fill in `OPENAI_API_KEY`, the three `AZURE_OPENAI_*` variables, or `ANTHROPIC_API_KEY` — whichever provider(s) you have. Model selection happens at runtime in the app's Settings screen, not via `.env`.

4. **Start the app:**

   ```powershell
   npm start
   ```

5. **Open your browser** to <http://localhost:3000>.

6. Click **▶ Run demo** to see the whole two-gate flow on a bundled sample with no API key needed, or point it at your own code and click **Analyze cloud readiness**.

To stop the server, press **Ctrl + C** in the terminal.

### Try it without an API key (demo mode)

Click **▶ Run demo (no API key needed)**. It loads a bundled sample (matching whichever source language is selected) and streams the same multi-agent pipeline using fixed, pre-computed results — no real API call is made, at either phase. Demo mode reacts to your Target Cloud and Migration Type selections, so switching them and re-running shows visibly different output.

To launch directly into demo mode (e.g. for a presentation), set `DEMO_MODE=1` before starting:

```powershell
$env:DEMO_MODE=1; npm start
```

---

## What's deliberately out of scope

Called out explicitly rather than silently absent, since this is a prototype meant to demonstrate the concepts, not a production system:

- **DevOps and Monitoring agents** — operate-phase concerns, not pre-migration assessment ones.
- **Real authentication / RBAC** — the role switcher is a demo convenience, not access control.
- **Secrets management, SSO, compliance certification** (ISO 27001/SOC 2/GDPR) — named as Pilot-phase items.
- **Private git repositories** — ingestion supports public repos only; no credential handling for cloning.
- **Whole-portfolio, multi-repo ingestion** — one repo or folder per run, capped at 200 files / 2MB combined. Portfolio-scale ingestion (the deck's 600-application scenario) would need chunked, multi-pass analysis.
- **A real database** — persistence is JSON files under `data/` (`data/store.js`), which is fine for a single-process prototype but isn't built for concurrent writers. SQLite/Postgres is the natural Pilot-phase upgrade.

### Scaling layers (scaffolded, not wired in)

Two capabilities a portfolio-scale version needs are present as real modules
under [`lib/`](lib/) with working stub implementations, but **deliberately not
connected to the pipeline** — so the design is on record and the integration
point is unambiguous:

- **RAG / retrieval** ([`lib/rag/`](lib/rag/)) — chunk + index a large codebase
  and retrieve only the relevant slices per agent, instead of the whole 2 MB
  blob. Not needed below the current 200-file / 2 MB ingest cap.
- **Agent response cache** ([`lib/cache/`](lib/cache/)) — skip an agent call when
  the same `(system + source + model)` was analyzed before (content-hash key);
  also the home for Anthropic prompt caching.

On/off flags live in **Settings → Scaling & performance** (architect role) and
in `store.getSettings().scaling`. While each layer's status is `"scaffolded"`,
toggling a flag persists and is audited but changes no pipeline behavior. See
[`lib/README.md`](lib/README.md) for activation steps.

---

## Project structure

```
CloudReadinessAnalyzer/
├── server.js                    # Express server + NDJSON streaming routes
├── providers.js                 # AI provider registry: OpenAI / Azure OpenAI / Claude, pricing
├── roles.js                     # demo role-switcher middleware (not real auth)
├── ingest.js                    # git clone / local folder ingestion
├── package.json
├── .env.example                 # copy to .env and add at least one provider's credentials
├── prompts/                     # versioned agent system prompts (data, not code)
│   ├── active.json              # pointer: which prompt version each agent loads
│   ├── loader.js                # getPrompt(agent, key, vars), imported by the agents
│   └── <agent>/v1.json          # one folder per agent, numbered version files
├── lib/                         # scaling layers — scaffolded, NOT wired into the pipeline
│   ├── scaling.js               # layer metadata + settings-flag shape
│   ├── rag/                     # chunker + RagIndex (Noop / in-memory lexical stub)
│   └── cache/                   # content-hash keys + AgentCache (Noop / in-memory LRU)
├── agents/
│   ├── assessmentPipeline.js    # Phase 1 graph: detect+dependency → score+strategize → estimate
│   ├── transformPipeline.js     # Phase 2 graph: modernize → validate
│   ├── detector.js              # Code Intelligence agent
│   ├── dependency.js            # Dependency Analysis agent (real static extraction + LLM risk pass)
│   ├── strategist.js            # Strategy Planner agent (+ conversational Gate A chat mode)
│   ├── scorer.js                # Scoring / Risk agent
│   ├── estimator.js             # Estimation agent
│   ├── modernizer.js            # Transformation agent
│   ├── validator.js             # Validation agent (deterministic checks + LLM finding-resolution pass)
│   ├── demo.js                  # canned fixtures for demo mode (both phases + chat)
│   ├── pipeline.js              # legacy single-pass pipeline, kept for /api/analyze only
│   └── shared.js                # runJsonAgent (OpenAI/Azure + Claude branches), shared helpers
├── data/
│   └── store.js                 # JSON-file persistence: runs, audit log, cost ledger, settings
├── public/                      # the web UI (no build step)
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── samples/                     # example legacy files to try
```

## Troubleshooting

- **"No AI provider is configured"** — make sure you created `.env` (not just `.env.example`) with a real key for at least one provider, then restart with `npm start`. Or click **Run demo** to try it without one.
- **Repository URL ingestion fails** — confirm `git` is installed and on your `PATH` (`git --version`), the URL is a public `https://` repo, and it's not a loopback/internal host (blocked as an SSRF guard).
- **Port already in use** — set a different port: in `.env` add `PORT=4000`, then open <http://localhost:4000>.
- **`npm` not recognized** — Node.js isn't installed or the terminal needs to be reopened after installing it.
- **Gate A / Gate B buttons are disabled** — you're acting as `viewer`; switch to `architect` in the header.
