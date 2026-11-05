import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { exec } from "./exec.ts";
import { must } from "./proc.ts";
import { changedPaths, repoTop, snapshot } from "./snapshot.ts";
import type { ItemProof, ProofResult } from "./types.ts";

/** Dependency folders linked into both copies, so the tests can run there. */
const DEPENDENCIES = ["node_modules", ".venv", "venv"];
const TEST_DIRS = new Set(["test", "tests", "__tests__", "testing"]);

/** Whether a project-relative path is a test file, kept as it is now in the copy from before. */
export function isTestFile(path: string): boolean {
  const name = basename(path);
  if (/\.(test|spec)\.[^.]+$/.test(name) || /^test_.*\.py$/.test(name) || /_test\.py$/.test(name) || name === "conftest.py") return true;
  return path.split("/").slice(0, -1).some((segment) => TEST_DIRS.has(segment));
}

function git(cwd: string, args: string[], env?: Record<string, string>) {
  return must(["git", ...args], { cwd, ...(env ? { env } : {}) });
}

/**
 * The tree "code from before the change, tests from now": `now` with every file the change
 * touched put back as it was in `before`, except the test files.
 */
export function previousTree(project: string, before: string, now: string): string {
  const top = repoTop(project);
  const revert = changedPaths(project, before, now).filter((p) => !isTestFile(p));
  const dir = mkdtempSync(join(tmpdir(), "hubspec-proof-index-"));
  try {
    const env = { GIT_INDEX_FILE: join(dir, "index") };
    git(top, ["read-tree", now], env);
    for (const p of revert) {
      const path = relative(top, join(project, p));
      const entry = git(top, ["ls-tree", before, "--", path]).trim();
      if (entry) {
        const [meta] = entry.split("\t");
        const [mode, , blob] = meta!.split(" ");
        git(top, ["update-index", "--add", "--cacheinfo", `${mode},${blob},${path}`], env);
      } else {
        git(top, ["update-index", "--force-remove", "--", path], env);
      }
    }
    return git(top, ["write-tree"], env).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes the project's part of `tree` into `dir`, without touching the repository. */
function extract(project: string, tree: string, dir: string): void {
  const top = repoTop(project);
  const prefix = relative(top, project);
  mkdirSync(dir, { recursive: true });
  const tarFile = join(dir, "..", `${basename(dir)}.tar`);
  try {
    git(top, ["archive", "--format=tar", "-o", tarFile, prefix ? `${tree}:${prefix}` : tree]);
    must(["tar", "-x", "-f", tarFile, "-C", dir]);
  } catch (err) {
    throw new Error(`não foi possível montar a cópia: ${(err as Error).message}`);
  } finally {
    rmSync(tarFile, { force: true });
  }
}

/** The project's dependency folders, linked (not copied) into a copy. */
function linkDependencies(project: string, dir: string): void {
  for (const name of DEPENDENCIES) {
    if (existsSync(join(project, name)) && !existsSync(join(dir, name))) symlinkSync(join(project, name), join(dir, name));
  }
}

export function classify(control: boolean, previous: boolean): ProofResult {
  if (!control) return "inconclusiva";
  return previous ? "fraca" : "forte";
}

/**
 * Red → green proof of one test: runs `argv` on a copy of the project as it is now (control)
 * and on a copy with the code from `before`. Both copies are temporary; the project itself
 * is never touched.
 */
export async function prove(input: { project: string; before: string; argv: string[]; timeoutMs: number }): Promise<ItemProof> {
  const { project, argv, timeoutMs } = input;
  const work = mkdtempSync(join(tmpdir(), "hubspec-proof-"));
  try {
    const now = snapshot(project);
    const previous = previousTree(project, input.before, now);
    const control = join(work, "controle");
    const old = join(work, "anterior");
    extract(project, now, control);
    extract(project, previous, old);
    // Files Git does not track (ignored config such as .env) are not copied; dependencies are linked.
    for (const dir of [control, old]) linkDependencies(project, dir);
    const c = await exec(argv, { cwd: control, timeoutMs });
    const p = await exec(argv, { cwd: old, timeoutMs });
    const ok = (r: typeof c) => r.exitCode === 0 && !r.timedOut;
    return { status: "concluida", result: classify(ok(c), ok(p)) };
  } catch (err) {
    return { status: "falhou", error: (err as Error).message };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
