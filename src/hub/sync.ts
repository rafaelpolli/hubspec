import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { currentBranch, git, isClone, isDirty, unpushed } from "./git.ts";
import { loadManifest, repoPath, type Repo } from "./manifest.ts";

export interface SyncResult {
  repo: string;
  action: "clonado" | "atualizado" | "em dia" | "pulado" | "falhou";
  detail?: string;
}

const lastLine = (text: string) => text.trim().split("\n").pop() ?? "";

/** Clones a repo into its path, on its working branch. */
export function clone(hub: string, repo: Repo): SyncResult {
  const dir = repoPath(hub, repo);
  mkdirSync(dirname(dir), { recursive: true });
  const res = git(hub, "clone", "--branch", repo.branch, repo.url, dir);
  if (res.ok) return { repo: repo.name, action: "clonado" };
  const missing = /Remote branch .* not found/.test(res.err);
  return { repo: repo.name, action: "falhou", detail: missing ? `o remote não tem a branch ${repo.branch} (a branch do repo no repos.yaml)` : lastLine(res.err) };
}

/**
 * Brings one repo up to date: clones it when missing, else a fast-forward pull of its working
 * branch. A clone on another branch, left on a change's (after `hub pr`) or made before the
 * working branch changed, goes to the working branch when nothing would be lost: no
 * uncommitted changes and every commit already on the remote.
 */
export function syncRepo(hub: string, repo: Repo): SyncResult {
  const dir = repoPath(hub, repo);
  if (!existsSync(dir)) return clone(hub, repo);
  if (!isClone(dir)) return { repo: repo.name, action: "falhou", detail: `${repo.path} existe e não é um clone Git` };
  if (isDirty(dir)) return { repo: repo.name, action: "pulado", detail: "há mudanças locais não commitadas" };
  const branch = currentBranch(dir);
  let back: string | undefined;
  if (branch !== repo.branch) {
    const ahead = unpushed(dir);
    if (ahead > 0) return { repo: repo.name, action: "pulado", detail: `está na branch ${branch}, com ${ahead} commit(s) que não estão no remote` };
    git(dir, "fetch", "-q", "origin", repo.branch); // a branch created after the clone
    const checkout = git(dir, "checkout", "-q", repo.branch);
    if (!checkout.ok) return { repo: repo.name, action: "falhou", detail: lastLine(checkout.err) };
    back = `voltou de ${branch} para ${repo.branch}`;
  }
  const before = git(dir, "rev-parse", "HEAD").out.trim();
  const pull = git(dir, "pull", "-q", "--ff-only", "origin", repo.branch);
  if (!pull.ok) return { repo: repo.name, action: "falhou", detail: lastLine(pull.err) };
  const after = git(dir, "rev-parse", "HEAD").out.trim();
  return { repo: repo.name, action: before === after ? "em dia" : "atualizado", ...(back ? { detail: back } : {}) };
}

/** `hub sync`: every active repo of the manifest; archived ones are not cloned. */
export function sync(hub: string): SyncResult[] {
  return loadManifest(hub)
    .repos.filter((r) => r.status === "active")
    .map((r) => syncRepo(hub, r));
}
