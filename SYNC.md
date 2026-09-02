# Keeping the two laptops in sync

One repo, one `master` branch, no folder-sync tools (OneDrive / Dropbox /
Syncthing on this directory corrupts `.git` and breaks native modules).

## Routine

| When | Command |
|---|---|
| Before starting work on a laptop | `npm run sync` &nbsp;(= `git pull --rebase && npm ci`) |
| Before switching to the other laptop — **even mid-task** | `git add -A && git commit -m "wip" && git push` |

If you never leave a laptop with uncommitted work, the two cannot diverge.

## Node version

Both laptops must run the **same Node** — pinned in [.nvmrc](.nvmrc) and
`engines` (Node 20.x). `better-sqlite3` is a native module: its prebuilt
binary is per-Node-version, so a mismatch means "server starts on one laptop
only". With `nvm`: `nvm install 20 && nvm use 20`.

## Never commit / never sync

- `node_modules/` — rebuild per machine with `npm ci`
- `data/*.json`, `data/store.sqlite*`, `data/outputs/` — runtime state, already
  in [.gitignore](.gitignore)
- `.env` — secrets

## If a laptop's server won't start

`better-sqlite3` failed to build. Fix: `nvm use 20 && npm ci`. If it still
builds from source and fails, install the C++ toolchain (Windows: “Desktop
development with C++” in Visual Studio Build Tools), then `npm ci`.
