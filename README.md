# Cloud Readiness Analyzer

An AI-powered tool that reviews a legacy **.NET (C#)** or **Java** code file (plus an optional `web.config` / `app.config` / `.properties` file) and reports:

- **Deprecated / unsupported APIs**
- **Hardcoded configuration** (connection strings, secrets, file paths, machine names)
- **Cloud incompatibilities** (local disk, in-process session, machine-bound state, etc.)
- A **modernized, cloud-ready version** of your code
- A **cloud-ready configuration** (environment variables / Azure Key Vault references)
- A **migration risk summary** and a **cloud readiness score (0–100)**

It runs **entirely on your own machine** and calls the OpenAI API with **your own API key**. Your code is only sent to OpenAI for the analysis — nothing is stored anywhere else.

### Features

- **Analyze a whole folder at once** — select multiple code files in the file picker and they are combined into a single analysis with one overall readiness score (each file is labelled in the combined view).
- **Before / after diff** — the modernized code can be flipped into a side-by-side diff against your original, with added/removed lines highlighted (toggle in the "Modernized code" panel header).
- **Download a report** — export the full analysis (score, risk, findings, modernized code, and cloud-ready config) as a Markdown file with one click.
- **No-key demo mode** — see the multi-agent pipeline run on a bundled `.NET` *or* `Java` sample without any API key.

## How it works: a multi-agent LangGraph pipeline

Instead of one big prompt, the analysis is split across three specialized AI agents wired together as a **[LangGraph](https://langchain-ai.github.io/langgraphjs/) `StateGraph`**. You watch each stage run live in the UI.

1. **Detection agent** — scans the code + config and reports only the issues (deprecated APIs, hardcoded config, cloud incompatibilities).
2. **Modernization agent** — takes the detected issues and rewrites the code + produces a cloud-ready configuration.
3. **Scoring agent** — takes the detected issues and produces the migration risk summary + cloud readiness score.

The graph (`agents/pipeline.js`) is:

```
            START
              │
              ▼
          ┌────────┐
          │ detect │
          └───┬────┘
        fan-out (parallel)
        ┌─────┴──────┐
        ▼            ▼
  ┌───────────┐ ┌─────────┐
  │ modernize │ │  score  │
  └─────┬─────┘ └────┬────┘
        └─────┬──────┘
             END
```

Detection runs first; Modernization and Scoring then run **in parallel** in the same LangGraph superstep, both reading the findings produced by Detection. Each node emits stage events that are streamed to the browser as the pipeline runs. If any agent returns an invalid response, the node throws and the graph surfaces a single clean error to the UI.

---

## Requirements

- **Node.js 18 or newer** — download from <https://nodejs.org> (the LTS installer is fine).
- An **OpenAI API key** — get one at <https://platform.openai.com/api-keys>.

To check Node is installed, open **PowerShell** (or Command Prompt) and run:

```powershell
node -v
```

You should see something like `v20.x` or `v22.x`.

---

## Setup on Windows (step by step)

1. **Get the folder** onto your PC and open a terminal in it.
   - In File Explorer, open the `cloud-readiness-analyzer` folder.
   - Click the address bar, type `powershell`, and press **Enter** — this opens PowerShell already in the right folder.

2. **Install dependencies** (only needed the first time):

   ```powershell
   npm install
   ```

3. **Add your OpenAI key.** Copy the example env file and edit it:

   ```powershell
   copy .env.example .env
   notepad .env
   ```

   In Notepad, set your key and save:

   ```
   OPENAI_API_KEY=sk-...your real key...
   ```

   (You can also change `OPENAI_MODEL` — `gpt-4o` is the default and gives the best results; `gpt-4o-mini` is cheaper and faster.)

4. **Start the app:**

   ```powershell
   npm start
   ```

   You'll see:

   ```
   ShiftWise — Cloud Readiness Analyzer
   Running at:  http://localhost:3000
   ```

5. **Open your browser** to <http://localhost:3000>.

6. Click **load sample** to try the included legacy `.cs` + `web.config`, or upload/paste your own file, then click **Analyze cloud readiness**.

To stop the server, press **Ctrl + C** in the terminal.

### Try it without an API key (demo mode)

Want to see the multi-agent pipeline run before setting up a key? Click
**▶ Run demo (no API key needed)** on the page. It loads a sample legacy file and
streams the same three-stage pipeline using a fixed, pre-computed analysis — no
OpenAI call is made. Pick **.NET (C#)** or **Java** in the Platform dropdown
before running the demo to see the matching sample analyzed. This is purely for
demonstration; real analysis still requires your own key.

To launch the app directly into demo mode (e.g. for a presentation), set
`DEMO_MODE=1` before starting:

```powershell
$env:DEMO_MODE=1; npm start
```

Leave `DEMO_MODE` unset for normal, key-based analysis.

---

## Project structure

```
cloud-readiness-analyzer/
├── server.js          # Express server + NDJSON stream (your key stays here, server-side)
├── package.json
├── .env.example       # copy to .env and add your key
├── agents/            # the multi-agent pipeline
│   ├── pipeline.js    # LangGraph StateGraph (detect → modernize + score in parallel)
│   ├── detector.js    # Detection agent
│   ├── modernizer.js  # Modernization agent
│   ├── scorer.js      # Scoring agent
│   └── shared.js      # shared agent helpers
├── public/            # the web UI (no build step)
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── samples/           # example legacy files to try
    ├── LegacyOrderService.cs
    ├── web.config
    ├── LegacyOrderService.java
    └── application.properties
```

## Troubleshooting

- **"OPENAI_API_KEY is not set"** — make sure you created `.env` (not just `.env.example`) and pasted a real key, then restart with `npm start`.
- **Port already in use** — set a different port: in `.env` add `PORT=4000`, then open <http://localhost:4000>.
- **`npm` not recognized** — Node.js isn't installed or the terminal needs to be reopened after installing it.
