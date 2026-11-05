import { existsSync } from "node:fs";
import { join } from "node:path";
import { must, run } from "../proc.ts";

/** Git in `cwd`, never prompting for credentials: authentication is the machine's (gh or SSH). */
export function git(cwd: string, ...args: string[]) {
  return run(["git", ...args], { cwd, env: { GIT_TERMINAL_PROMPT: "0" } });
}

export function gitMust(cwd: string, ...args: string[]): string {
  return must(["git", ...args], { cwd, env: { GIT_TERMINAL_PROMPT: "0" } }).trim();
}

export function isClone(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

export function head(dir: string): string | undefined {
  const res = git(dir, "rev-parse", "HEAD");
  return res.ok ? res.out.trim() : undefined;
}

export function currentBranch(dir: string): string {
  return git(dir, "rev-parse", "--abbrev-ref", "HEAD").out.trim();
}

/** Uncommitted changes, staged, unstaged or untracked. */
export function isDirty(dir: string): boolean {
  return git(dir, "status", "--porcelain").out.trim() !== "";
}

/** Local commits not on any remote branch: work that would be lost with the clone. */
export function unpushed(dir: string): number {
  const res = git(dir, "rev-list", "--count", "HEAD", "--not", "--remotes");
  return res.ok ? Number(res.out.trim()) : 0;
}

export function branchExists(dir: string, branch: string): boolean {
  return git(dir, "rev-parse", "--verify", "-q", `refs/heads/${branch}`).ok;
}
