// Repository ingestion: clone a public git URL or read a local folder,
// collect the source files that match the selected language, and concatenate
// them into the same combined-source shape the browser's file/folder picker
// already produces (see buildSourceBlock in agents/shared.js). Public repos
// only — no credential handling — and every clone is cleaned up after use.
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const CLONE_PREFIX = "shiftwise-clone-";
const CLONE_TIMEOUT_MS = 60_000;
const MAX_FILES = 200;
const MAX_BYTES = 2 * 1024 * 1024;
const CONFIG_MAX_FILES = 25;
const CONFIG_MAX_BYTES = 256 * 1024;

// Well-known application-config filenames, matched case-insensitively.
// Deliberately excludes .env — that is usually real secrets, not settings.
const CONFIG_MATCHERS = [
  /^appsettings.*\.json$/i,
  /^application.*\.properties$/i,
  /^application.*\.ya?ml$/i,
  /^bootstrap.*\.ya?ml$/i,
  /\.config$/i, // web.config, app.config, nlog.config, log4net.config, …
];

function isConfigFile(name) {
  return CONFIG_MATCHERS.some((re) => re.test(name));
}

const SKIP_DIRS = new Set([
  ".git", "node_modules", "bin", "obj", "dist", "build", "target",
  ".vs", ".vscode", ".idea", "vendor", "__pycache__", ".venv",
]);

const EXTENSIONS_BY_LANGUAGE = {
  ".NET": [".cs"],
  Java: [".java"],
  COBOL: [".cbl", ".cob"],
  "VB6 / VB.NET": [".vb", ".bas", ".cls", ".frm"],
  PHP: [".php"],
  Python: [".py"],
};

export function extensionsFor(language) {
  return EXTENSIONS_BY_LANGUAGE[language] || EXTENSIONS_BY_LANGUAGE[".NET"];
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// Basic SSRF guard: refuse hosts that are obviously loopback/private/
// link-local, so a pasted URL can't be used to make the server clone from
// somewhere it shouldn't. Not exhaustive (doesn't resolve DNS), but cheap
// and catches the obvious cases.
function isDisallowedHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

// Shallow-clones a public repo into a fresh temp directory. Uses execFile
// with an argument array (never a shell string), so a malicious URL/branch
// can't inject shell commands. Returns the temp directory path — caller is
// responsible for calling cleanupClone() on it when done.
export async function cloneRepo(url, branch) {
  if (!isHttpsUrl(url)) {
    throw new Error("Only https:// repository URLs are supported.");
  }
  const { hostname } = new URL(url);
  if (isDisallowedHost(hostname)) {
    throw new Error("That repository host is not allowed.");
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), CLONE_PREFIX));
  const args = ["clone", "--depth", "1", "--single-branch"];
  if (branch && String(branch).trim()) {
    args.push("--branch", String(branch).trim());
  }
  args.push(url, tmpDir);

  try {
    await execFileAsync("git", args, { timeout: CLONE_TIMEOUT_MS });
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const message = err.killed ? "Clone timed out." : (err.stderr || err.message || "Clone failed.");
    throw new Error(`Failed to clone repository: ${String(message).trim().slice(0, 300)}`);
  }
  return tmpDir;
}

export function cleanupClone(dir) {
  if (dir && dir.startsWith(os.tmpdir()) && path.basename(dir).startsWith(CLONE_PREFIX)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Removes any clone temp dirs left behind by a prior crashed run. Safe to
// call on every server start.
export function sweepOrphanedClones() {
  const tmp = os.tmpdir();
  let entries;
  try {
    entries = fs.readdirSync(tmp);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(CLONE_PREFIX)) {
      try {
        fs.rmSync(path.join(tmp, entry), { recursive: true, force: true });
      } catch {
        // best-effort cleanup only
      }
    }
  }
}

export function assertLocalDirectory(localPath) {
  if (!localPath || !String(localPath).trim()) {
    throw new Error("No local path was provided.");
  }
  if (!fs.existsSync(localPath)) {
    throw new Error(`Path does not exist: ${localPath}`);
  }
  if (!fs.statSync(localPath).isDirectory()) {
    throw new Error(`Path is not a directory: ${localPath}`);
  }
  return localPath;
}

function walk(dir, exts, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), exts, results);
    } else if (exts.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
      results.push(path.join(dir, entry.name));
    }
  }
}

// Walks `dir`, collects files matching `language`'s extensions, and
// concatenates them using the same "// ===== filename =====" header
// convention the browser's multi-file picker already uses, capped at
// MAX_FILES / MAX_BYTES. Returns { code, filesIncluded, filesTotal, truncated }.
export function collectSourceFiles(dir, language) {
  const exts = extensionsFor(language);
  const allFiles = [];
  walk(dir, exts, allFiles);
  allFiles.sort();
  const filesTotal = allFiles.length;

  const parts = [];
  let bytesUsed = 0;
  let filesIncluded = 0;

  for (const file of allFiles) {
    if (filesIncluded >= MAX_FILES) break;
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(dir, file).split(path.sep).join("/");
    const chunk = `// ===== ${rel} =====\n${content}\n`;
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    if (bytesUsed + chunkBytes > MAX_BYTES) break;
    parts.push(chunk);
    bytesUsed += chunkBytes;
    filesIncluded += 1;
  }

  return {
    code: parts.join("\n"),
    filesIncluded,
    filesTotal,
    truncated: filesIncluded < filesTotal,
  };
}

function walkConfig(dir, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkConfig(path.join(dir, entry.name), results);
    } else if (isConfigFile(entry.name)) {
      results.push(path.join(dir, entry.name));
    }
  }
}

// Walks `dir` for well-known config files and concatenates them with the same
// "// ===== path =====" header convention collectSourceFiles uses, capped at
// CONFIG_MAX_FILES / CONFIG_MAX_BYTES. Returns { config, files } where `files`
// is the list of repo-relative paths actually included.
export function collectConfigFiles(dir) {
  const found = [];
  walkConfig(dir, found);
  found.sort();

  const parts = [];
  const files = [];
  let bytesUsed = 0;

  for (const file of found) {
    if (files.length >= CONFIG_MAX_FILES) break;
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(dir, file).split(path.sep).join("/");
    const chunk = `// ===== ${rel} =====\n${content}\n`;
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    if (bytesUsed + chunkBytes > CONFIG_MAX_BYTES) break;
    parts.push(chunk);
    files.push(rel);
    bytesUsed += chunkBytes;
  }

  return { config: parts.join("\n"), files };
}
