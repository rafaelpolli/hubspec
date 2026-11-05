import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { branchExists, currentBranch, git, gitMust, isClone, isDirty } from "./git.ts";
import { createPr, editPrBody, prOf } from "./github.ts";
import { dependencyOrder, findRepo, loadManifest, repoPath, type Repo } from "./manifest.ts";
import { declaredDependencies, linkPr, MANUAL, parseHubTasks, taskRepos, type HubTask } from "./tasks.ts";

export interface PrResult {
  repo: string;
  state: "aberta" | "existente" | "pulado" | "planejada";
  url?: string;
  detail?: string;
}

/** The proposal's title and the text for the PR description (its Why and What Changes). */
function proposal(changeDir: string, change: string): { title: string; body: string } {
  const file = join(changeDir, "proposal.md");
  if (!existsSync(file)) return { title: change, body: "" };
  const text = readFileSync(file, "utf8");
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? change;
  const body = text.replace(/^#\s+.+\n+/, "").trim();
  return { title, body: body.length > 6000 ? `${body.slice(0, 6000)}\n\n…` : body };
}

function prBody(change: string, text: string, order: readonly { repo: Repo; url?: string }[], self: string): string {
  const n = order.findIndex((o) => o.repo.name === self) + 1;
  const inChange = new Set(order.map((o) => o.repo.name));
  const deps = (r: Repo) => r.dependsOn.map((d) => d.repo).filter((d) => inChange.has(d));
  const siblings = order.map((o, i) => {
    const after = deps(o.repo);
    return `${i + 1}. ${o.repo.name}${o.url ? `: ${o.url}` : ""}${after.length ? ` (depende de: ${after.join(", ")})` : ""}${o.repo.name === self ? " ← esta PR" : ""}`;
  });
  return [
    `Parte da change \`${change}\` do hub (passo ${n} de ${order.length}).`,
    "",
    "## Ordem de merge",
    "",
    ...siblings,
    "",
    order.length > 1 ? "Faça o merge nesta ordem: cada PR depende das anteriores." : "Esta change só tem esta PR.",
    "",
    ...(text ? ["## Proposta", "", text, ""] : []),
  ].join("\n");
}

/** Puts the repo on the change's branch, carrying its pending changes, and commits them. */
function prepareBranch(dir: string, change: string, title: string): void {
  if (currentBranch(dir) !== change) {
    if (branchExists(dir, change)) gitMust(dir, "checkout", change);
    else gitMust(dir, "checkout", "-b", change);
  }
  if (isDirty(dir)) {
    gitMust(dir, "add", "-A");
    gitMust(dir, "commit", "-q", "-m", `${change}: ${title}`);
  }
}

/** Commits of the change's branch that the default branch on the remote does not have. */
function ahead(dir: string, base: string): number {
  git(dir, "fetch", "-q", "origin", base);
  const res = git(dir, "rev-list", "--count", `origin/${base}..HEAD`);
  return res.ok ? Number(res.out.trim()) : 1;
}

/**
 * `hub pr <change>` (spec 6): for each repo whose tasks are all done, the change's branch is
 * pushed and its PR opened (or reused); then every PR lists its siblings in merge order, and
 * each task gets its PR link. Repos are ordered by their dependencies, those of repos.yaml
 * and those the change declares in its section titles, ties by task order. An open [manual]
 * task blocks everything (spec 9.2).
 */
export function openPrs(hub: string, change: string, opts: { dryRun?: boolean } = {}): PrResult[] {
  const changeDir = join(hub, "openspec", "changes", change);
  const tasksFile = join(changeDir, "tasks.md");
  if (!existsSync(tasksFile)) throw new Error(`a change ${change} não tem tasks.md`);
  const m = loadManifest(hub);
  const names = m.repos.map((r) => r.name);
  const tasks = parseHubTasks(readFileSync(tasksFile, "utf8"), names);
  const untagged = tasks.filter((t) => !t.repo);
  if (untagged.length > 0) throw new Error(`há tasks sem repo (${untagged.map((t) => t.id ?? t.text).join(", ")}): toda task começa com [repo] ou [manual]`);
  const manual = tasks.filter((t) => t.repo === MANUAL && !t.done);
  if (manual.length > 0) {
    throw new Error(`a task manual ${manual.map((t) => t.id ?? t.text).join(", ")} ainda está aberta e bloqueia as demais: conclua-a (para um repo novo, \`hubspec hub add <url> --new --change ${change}\`)`);
  }
  const byRepo = (r: string) => tasks.filter((t: HubTask) => t.repo === r);
  const declared = declaredDependencies(readFileSync(tasksFile, "utf8"));
  for (const [repo, deps] of declared) {
    for (const d of [repo, ...deps]) if (!names.includes(d)) throw new Error(`tasks.md declara "${repo} (depende de: ${deps.join(", ")})", mas ${d} não está no repos.yaml`);
  }
  // The manifest's dependencies plus the ones this change declares, for the merge order.
  const withChange = (r: Repo): Repo => ({ ...r, dependsOn: [...r.dependsOn, ...(declared.get(r.name) ?? []).filter((d) => !r.dependsOn.some((x) => x.repo === d)).map((d) => ({ repo: d }))] });
  const repos = dependencyOrder(taskRepos(tasks).map((r) => withChange(findRepo(m, r))));
  const { title, body } = proposal(changeDir, change);

  const results: PrResult[] = [];
  const opened: { repo: Repo; url?: string }[] = [];
  for (const repo of repos) {
    const open = byRepo(repo.name).filter((t) => !t.done);
    const dir = repoPath(hub, repo);
    if (open.length > 0) results.push({ repo: repo.name, state: "pulado", detail: `${open.length} task(s) em aberto: ${open.map((t) => t.id ?? t.text).join(", ")}` });
    else if (!isClone(dir)) results.push({ repo: repo.name, state: "pulado", detail: `não está clonado em ${repo.path}` });
    else if (opts.dryRun) {
      results.push({ repo: repo.name, state: "planejada", detail: `branch ${change} → ${repo.branch}` });
      opened.push({ repo });
    } else {
      prepareBranch(dir, change, title);
      if (ahead(dir, repo.branch) === 0) {
        results.push({ repo: repo.name, state: "pulado", detail: `a branch ${change} não tem commits além de ${repo.branch}` });
        continue;
      }
      gitMust(dir, "push", "-q", "-u", "origin", change);
      const existing = prOf(dir, change);
      const url = existing?.url ?? createPr(dir, { base: repo.branch, head: change, title, body: prBody(change, body, [{ repo }], repo.name) });
      results.push({ repo: repo.name, state: existing ? "existente" : "aberta", url });
      opened.push({ repo, url });
    }
  }
  if (opts.dryRun) return results;

  // The siblings and the merge order go into every PR once all of them exist.
  for (const o of opened) editPrBody(repoPath(hub, o.repo), o.url!, prBody(change, body, opened, o.repo.name));
  let text = readFileSync(tasksFile, "utf8");
  for (const o of opened) text = linkPr(text, names, o.repo.name, o.url!);
  writeFileSync(tasksFile, text);
  return results;
}
