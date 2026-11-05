import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { isGit, snapshot } from "./snapshot.ts";

/** The report and hubspec's own folder, left out: writing them must not make the report stale. */
export const REPORT_FILE = "verification.md";
export const WORK_DIR = ".hubspec";
const SKIP = new Set([".git", "node_modules"]);

function isWithin(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function walk(dir: string, base: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(e.name)) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) walk(path, base, out);
    else out.push(relative(base, path));
  }
}

/** Hash of the files' paths and contents under `dir`, minus the files under `except`. */
function contentHash(dir: string, except: readonly string[]): string {
  const hash = createHash("sha256");
  const files: string[] = [];
  walk(dir, dir, files);
  for (const file of files) {
    if (except.some((e) => isWithin(e, file))) continue;
    hash.update(file).update("\0").update(readFileSync(join(dir, file))).update("\0");
  }
  return hash.digest("hex");
}

/** Hash of the paths, sizes and times of a folder outside Git. */
function statHash(dir: string, exclude: readonly string[]): string {
  const hash = createHash("sha256");
  const files: string[] = [];
  walk(dir, dir, files);
  for (const file of files) {
    if (exclude.some((e) => isWithin(e, file))) continue;
    const st = statSync(join(dir, file));
    hash.update(`${file}\0${st.size}\0${st.mtimeMs}\0`);
  }
  return hash.digest("hex");
}

const codeHash = (dir: string, exclude: readonly string[]) => (isGit(dir) ? snapshot(dir, exclude) : statHash(dir, exclude));

/**
 * What a verification checked: the code, and the change's artifacts without the report and
 * the `.hubspec/` folder. The code is the project without its `openspec/` or, in a hub, each
 * cloned repo (the hub's own docs do not make a verification stale).
 */
export function fingerprint(project: string, changeDir: string, repos?: readonly { name: string; path: string }[]): Record<string, string> {
  const code = repos ? Object.fromEntries(repos.map((r) => [`repo:${r.name}`, codeHash(r.path, [])])) : { code: codeHash(project, ["openspec"]) };
  return { ...code, artifacts: contentHash(changeDir, [REPORT_FILE, WORK_DIR]) };
}

/** True when two fingerprints differ in any key. */
export function changed(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].some((k) => a[k] !== b[k]);
}
