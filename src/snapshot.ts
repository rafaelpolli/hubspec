import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { run } from "./proc.ts";

/**
 * Snapshots of the project's working tree, taken with a temporary Git index so the user's
 * index, HEAD and branches are never touched and no commit is made. A snapshot is a tree
 * object of the files as they are, pending changes included; `.gitignore`d files are left out.
 */

function git(cwd: string, args: string[], env?: Record<string, string>) {
  return run(["git", ...args], { cwd, ...(env ? { env } : {}) });
}

/** Runs `fn` with a throwaway index, seeded from the user's so unchanged files are not rehashed. */
function withTempIndex<T>(dir: string, fn: (env: Record<string, string>) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "hubspec-index-"));
  try {
    const index = join(tmp, "index");
    const own = git(dir, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).out.trim();
    if (own && existsSync(own)) {
      copyFileSync(own, index);
      // Git trusts an entry's stat data only when the file is older than the index: the copy
      // keeps the original's time, or a same-size edit in the same second would go unseen.
      const { atime, mtime } = statSync(own);
      utimesSync(index, atime, mtime);
    }
    return fn({ GIT_INDEX_FILE: index });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Whether `dir` is inside a Git work tree. */
export function isGit(dir: string): boolean {
  try {
    const inside = git(dir, ["rev-parse", "--is-inside-work-tree"]);
    return inside.ok && inside.out.trim() === "true";
  } catch {
    return false; // the folder does not exist
  }
}

/**
 * The files under `dir` as they are now, as a tree id of the whole repository. `exclude`
 * lists `dir`-relative folders left out of the tree (the root's `openspec/`).
 */
export function snapshot(dir: string, exclude: readonly string[] = []): string {
  return withTempIndex(dir, (env) => {
    if (exclude.length > 0) {
      // The seed index has those files; they must not stay in the tree either.
      git(dir, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ...exclude], env);
    }
    const add = git(dir, ["add", "-A", "--", ".", ...exclude.map((e) => `:(exclude)${e}`)], env);
    if (!add.ok) throw new Error(`git add falhou em ${dir}: ${add.err.trim()}`);
    const tree = git(dir, ["write-tree"], env);
    if (!tree.ok) throw new Error(`git write-tree falhou em ${dir}: ${tree.err.trim()}`);
    return tree.out.trim();
  });
}

/** The tree of a commit-ish, such as `HEAD` or `main`. */
export function treeOf(dir: string, ref: string): string {
  const res = git(dir, ["rev-parse", "--verify", "-q", `${ref}^{tree}`]);
  if (!res.ok) throw new Error(`${ref} não é um commit deste repositório`);
  return res.out.trim();
}

/** Top of the repository `dir` is in. */
export function repoTop(dir: string): string {
  return git(dir, ["rev-parse", "--show-toplevel"]).out.trim();
}

/** The `dir`-relative paths that differ between two snapshots. */
export function changedPaths(dir: string, before: string, after: string): string[] {
  if (before === after) return [];
  const top = repoTop(dir);
  const spec = git(dir, ["rev-parse", "--show-prefix"]).out.trim() || ".";
  const list = git(top, ["diff-tree", "-r", "--no-renames", "--name-only", "-z", before, after, "--", spec]);
  if (!list.ok) throw new Error(`git diff-tree falhou em ${dir}: ${list.err.trim()}`);
  return list.out
    .split("\0")
    .filter(Boolean)
    .map((fromTop) => relative(dir, join(top, fromTop)))
    .sort();
}
