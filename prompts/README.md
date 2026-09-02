# `prompts/` — versioned agent system prompts

Every agent's **system prompt** lives here as data, not as an inline string in
`agents/*.js`. Edit a prompt without touching code; keep old versions side by
side; see exactly what changed in `git diff`.

## Layout

```
prompts/
├── active.json          # pointer: which version each agent loads
├── loader.js            # getPrompt(agent, key, vars) — imported by the agents
├── README.md            # this file
├── detector/
│   └── v1.json
├── dependency/
│   └── v1.json
├── scorer/
│   └── v1.json
├── estimator/
│   └── v1.json
├── strategist/
│   └── v1.json          # keys: "system", "chatSystem"
├── modernizer/
│   └── v1.json          # keys: "systemSameLanguage", "systemCrossTech"
└── validator/
    └── v1.json
```

`active.json` maps each agent id to the version file it loads:

```json
{ "detector": "v1", "dependency": "v1", "...": "v1" }
```

At server startup the console prints the loaded set, e.g.
`Prompts: detector@v1 dependency@v1 …`.

## Version file shape

```json
{
  "id": "detector",
  "name": "Code Intelligence",
  "version": "v1",
  "updated": "2026-09-02",
  "notes": "What changed and why.",
  "prompts": {
    "system": [
      "First line of the prompt.",
      "",
      "Another paragraph after a blank line."
    ]
  }
}
```

- **`prompts`** holds one or more named prompts. Most agents have just
  `system`. `strategist` has `system` + `chatSystem` (Gate A chat).
  `modernizer` has `systemSameLanguage` + `systemCrossTech`.
- Each prompt body is an **array of lines**, joined with `\n` on load. One
  array element per line keeps version-to-version diffs readable.
- Everything outside `prompts` is metadata for humans — the loader only reads
  `prompts`.

## Placeholders

Templated prompts use `{{token}}`, filled by the caller:

| Agent | Prompt(s) | Tokens |
|---|---|---|
| `strategist` | `system` | `{{targetLanguages}}` |
| `strategist` | `chatSystem` | `{{targetLanguages}}`, `{{architecturePatterns}}` |
| `modernizer` | `systemCrossTech` | `{{targetLanguage}}`, `{{secretStore}}` |
| `modernizer` | `systemSameLanguage` | `{{secretStore}}` |

An unfilled `{{token}}` throws at load time rather than reaching the model.

## Changing a prompt

**Small tweak, keep the version number:** edit the active `vN.json` in place,
bump `updated`, note it in `notes`. Git history is the record.

**Meaningful revision you want to be able to roll back:**

1. `cp prompts/detector/v1.json prompts/detector/v2.json`
2. Edit `v2.json` — change `version` to `"v2"`, update `updated` / `notes`,
   edit the prompt lines.
3. Point `active.json` at it: `"detector": "v2"`.
4. Restart. Startup log shows `detector@v2`. Roll back by setting it to `"v1"`.

Old version files are kept, never deleted — that's the point.

## What is *not* here

The JSON **result schemas** (`RESULT_SCHEMA` in each agent) stay in code —
they're validation contracts wired to parsing logic, not prose. The
deterministic scans (dependency import extraction, validator static checks)
are code too. Only the natural-language system prompts live here.
