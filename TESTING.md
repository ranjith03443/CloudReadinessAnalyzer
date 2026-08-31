# Testing Guide

A step-by-step walkthrough for testing ShiftWise locally. Everything except section 7 works without a real API key, using demo mode.

## 1. Setup

```powershell
npm install
copy .env.example .env
npm start
```

You should see a startup banner. Open **http://localhost:3000**.

## 2. Full flow, no API key needed (demo mode)

This is the fastest way to see everything end to end:

1. In the header, click **Architect** in the role switcher (Gate A/B actions need this role).
2. Leave Target Cloud as Azure (or try AWS/GCP — demo mode reacts to it).
3. Click **▶ Run demo (no API key needed)**.
4. Watch the 5-stage progress list run, then review the report: **Overview**, **Strategy** (the AI's recommendation), **Findings**, **Dependencies**, **Run Stats** tabs.
5. At the **Gate A** panel at the bottom:
   - Try **Discuss with AI** — type something like "we're an AWS shop" or "what if we rewrite this in Java?" and watch it respond, then click **Apply to form** if it suggests something.
   - Or just edit the **Migration type** / **Target architecture pattern** dropdowns directly.
   - Click **Confirm & proceed**.
6. Watch the 2-stage transformation progress, then check the new **Modernized Code** (try the diff toggle), **Cloud Config**, and **Validation** tabs.
7. At **Gate B**, add a comment and click **Approve** (or **Reject**) — the report banner updates to match.
8. Click **↓ Download report (.md)** to see the full exported report with the status stamp.

## 3. Try the other paths

- **Stop at Gate A**: run demo again, click **Stop here** instead of proceeding — confirm no code gets generated.
- **Cross-Tech**: run demo, at Gate A switch Migration Type to **Cross-Tech Migration**, pick a target language (e.g. Java), proceed — check the Validation tab for the "manual review recommended" flag and translation assumptions.
- **Re-assess**: before deciding Gate A, change Target Cloud in the left panel and click **↻ Re-assess with current inputs** — confirm it updates in place rather than starting a new run.

## 4. Real ingestion

- Switch source mode to **Repository URL**, paste a small public repo (e.g. `https://github.com/dotnet-architecture/eShopOnWeb.git`), click **Clone & ingest** — watch the file-count summary.
- Or try **Local path** with a folder already on your machine.
- Then run demo mode (or real mode) against the ingested code.

## 5. Governance

- Switch the role to **Viewer** — confirm Gate A/B buttons are disabled, and **Audit Log** / **Cost & Budget** / **Settings** disappear from the header.
- Switch back to **Architect**, click **Past Runs** to see history, click a row to see detail, **Audit Log** to see every logged action.

## 6. Cost & Settings

- Click **Settings** — see credential status per provider (all will show "no credentials" unless you've set a key), pick a default provider/model, save it.
- Click **AI Cost & Budget** — filter by date range or by a specific run ID, or click **This run** from an open report.

## 7. With a real API key (optional but recommended)

Edit `.env`, add a real `OPENAI_API_KEY` (or `AZURE_OPENAI_*` / `ANTHROPIC_API_KEY`), restart (`npm start`), then repeat the same flow with **Run demo** replaced by **Analyze cloud readiness**. This is the one path that hasn't been verified against a live provider during development — no credentials were available in that environment — so it's worth doing at least once to confirm live output looks right.
