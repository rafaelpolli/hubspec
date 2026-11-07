import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { archivedDocsDir, docsDir, readMeta, updateOverview } from "./document.ts";
import { currentBranch, git, head, isClone, isDirty, unpushed } from "./git.ts";
import {
  dependents,
  findRepo,
  loadManifest,
  ManifestError,
  nameFromUrl,
  repoPath,
  saveManifest,
  WORKSPACE,
  type Dependency,
  type Repo,
} from "./manifest.ts";
import { syncRepo, type SyncResult } from "./sync.ts";
import { completeManual, type HubTask } from "./tasks.ts";

/** The default branch of a remote, from its HEAD; `main` when the remote does not say. */
export function remoteDefaultBranch(cwd: string, url: string): string {
  const res = git(cwd, "ls-remote", "--symref", url, "HEAD");
  return /^ref:\s+refs\/heads\/(\S+)\s+HEAD/m.exec(res.out)?.[1] ?? "main";
}

/** Whether the remote has `branch`; undefined when the remote could not be reached. */
export function remoteHasBranch(cwd: string, url: string, branch: string): boolean | undefined {
  const res = git(cwd, "ls-remote", url, `refs/heads/${branch}`);
  return res.ok ? res.out.trim() !== "" : undefined;
}

/** Refuses a name Git would not take as a branch (`--branch "a b"`). */
export function checkBranchName(cwd: string, branch: string): void {
  if (!git(cwd, "check-ref-format", "--branch", branch).ok) throw new ManifestError(`--branch: "${branch}" não é um nome de branch válido`);
}

/**
 * `hub init --branch <b>`: the hub's working branch, for the repos registered without
 * `--branch`. A new branch moves every repo to it, also those that had one of their own (they
 * are in `moved`, to be set again with `hub add <url> --branch`); the same branch changes nothing.
 */
export function setHubBranch(hub: string, branch: string): { changed: boolean; moved: { name: string; from: string }[] } {
  checkBranchName(hub, branch);
  const m = loadManifest(hub);
  if (m.branch === branch) return { changed: false, moved: [] };
  const moved = m.repos.filter((r) => r.branch !== branch).map((r) => ({ name: r.name, from: r.branch }));
  m.branch = branch;
  for (const r of m.repos) r.branch = branch;
  saveManifest(hub, m);
  return { changed: true, moved };
}

export interface AddOptions {
  name?: string;
  branch?: string;
  description?: string;
  tags?: string[];
  depends?: string[];
  /** The repo was just created by the organization's automation, for `change`. */
  isNew?: boolean;
  change?: string;
}

export interface AddResult {
  repo: Repo;
  /** The repo was already in the manifest with this URL. */
  existed: boolean;
  /** Registered, but something will fail later: the remote lacks the hub's branch. */
  warning?: string;
  sync?: SyncResult;
  /** The manual task checked in the change's tasks.md. */
  manualTask?: HubTask;
}

/**
 * `hub add <url>`: registers a repo (idempotent: the same URL again only updates the fields
 * given). With `--new --change`, also clones it, links it to the change, marks it as created
 * from the template and checks the change's manual "create the repo" task.
 */
export function addRepo(hub: string, url: string, opts: AddOptions = {}): AddResult {
  if (opts.isNew && !opts.change) throw new ManifestError("--new precisa de --change <change>");
  if (opts.branch) checkBranchName(hub, opts.branch);
  const changeDir = opts.change ? join(hub, "openspec", "changes", opts.change) : undefined;
  if (changeDir && !existsSync(changeDir)) throw new ManifestError(`a change ${opts.change} não existe em openspec/changes`);
  const m = loadManifest(hub);
  const name = opts.name ?? nameFromUrl(url);
  const known = new Set(m.repos.map((r) => r.name));
  for (const d of opts.depends ?? []) if (d !== name && !known.has(d)) throw new ManifestError(`--depends: o repo ${d} não está no repos.yaml`);
  let repo = m.repos.find((r) => r.name === name);
  const existed = !!repo;
  if (repo && repo.url !== url) throw new ManifestError(`já existe um repo ${name} com outra URL (${repo.url}): use --name`);
  let warning: string | undefined;
  if (!repo) {
    // Its own branch, else the hub's (checked on the remote), else the remote's default.
    const branch = opts.branch ?? m.branch ?? remoteDefaultBranch(hub, url);
    if (!opts.branch && m.branch && remoteHasBranch(hub, url, m.branch) === false) {
      warning = `${name} não tem a branch ${m.branch} no remote: o sync falha até ela existir. Se o repo trabalha em outra branch: \`hubspec hub add ${url} --branch <branch>\``;
    }
    repo = { name, url, branch, path: `${WORKSPACE}/${name}`, tags: [], dependsOn: [], status: "active" };
    m.repos.push(repo);
  }
  if (opts.branch) repo.branch = opts.branch;
  if (opts.description) repo.description = opts.description;
  if (opts.tags?.length) repo.tags = [...new Set([...repo.tags, ...opts.tags])];
  for (const d of opts.depends ?? []) if (!repo.dependsOn.some((x) => x.repo === d)) repo.dependsOn.push({ repo: d, source: "manual" });
  repo.status = "active";
  if (opts.change) repo.changes = [...new Set([...(repo.changes ?? []), opts.change])];
  if (opts.isNew) repo.template = true;
  saveManifest(hub, m);

  const result: AddResult = { repo, existed, ...(warning ? { warning } : {}) };
  if (opts.isNew) {
    result.sync = syncRepo(hub, repo);
    const tasks = join(changeDir!, "tasks.md");
    if (existsSync(tasks)) {
      const done = completeManual(readFileSync(tasks, "utf8"), m.repos.map((r) => r.name));
      if (done.task) {
        writeFileSync(tasks, done.markdown);
        result.manualTask = done.task;
      }
    }
  }
  updateOverview(hub, m);
  return result;
}

export interface DependsOptions {
  set?: string[];
  add?: string[];
  remove?: string[];
  via?: string;
  source?: Dependency["source"];
}

/**
 * `hub depends <repo>`: changes a repo's dependencies. The agent uses it with `--source llm`
 * for the ones it finds in the code while documenting; the map is regenerated from it.
 */
export function setDependencies(hub: string, name: string, opts: DependsOptions): Repo {
  const m = loadManifest(hub);
  const repo = findRepo(m, name);
  const known = new Set(m.repos.map((r) => r.name));
  for (const d of [...(opts.set ?? []), ...(opts.add ?? [])]) {
    if (d === name) throw new ManifestError(`${name} não pode depender de si mesmo`);
    if (!known.has(d)) throw new ManifestError(`o repo ${d} não está no repos.yaml`);
  }
  const dep = (r: string): Dependency => ({ repo: r, ...(opts.via ? { via: opts.via } : {}), source: opts.source ?? "manual" });
  if (opts.set) repo.dependsOn = opts.set.map((r) => repo.dependsOn.find((d) => d.repo === r && !opts.via && !opts.source) ?? dep(r));
  for (const r of opts.add ?? []) {
    const i = repo.dependsOn.findIndex((d) => d.repo === r);
    if (i >= 0) repo.dependsOn[i] = { ...repo.dependsOn[i]!, ...(opts.via ? { via: opts.via } : {}), ...(opts.source ? { source: opts.source } : {}) };
    else repo.dependsOn.push(dep(r));
  }
  if (opts.remove) repo.dependsOn = repo.dependsOn.filter((d) => !opts.remove!.includes(d.repo));
  saveManifest(hub, m);
  updateOverview(hub, m);
  return repo;
}

/** `hub archive <repo>`: retired, not removed. Returns the repos that still depend on it. */
export function archiveRepo(hub: string, name: string): { repo: Repo; dependents: Repo[] } {
  const m = loadManifest(hub);
  const repo = findRepo(m, name);
  const deps = dependents(m, name);
  repo.status = "archived";
  const from = docsDir(hub, name);
  const to = archivedDocsDir(hub, name);
  if (existsSync(from)) {
    rmSync(to, { recursive: true, force: true });
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  }
  saveManifest(hub, m);
  updateOverview(hub, m);
  return { repo, dependents: deps };
}

/** Why removing a repo's clone would lose work, or undefined when it is safe. */
export function unsafeToDelete(dir: string): string | undefined {
  if (!existsSync(dir) || !isClone(dir)) return undefined;
  if (isDirty(dir)) return "o clone tem mudanças não commitadas";
  const ahead = unpushed(dir);
  if (ahead > 0) return `o clone tem ${ahead} commit(s) que não estão em nenhum remote`;
  return undefined;
}

/**
 * `hub remove <repo>` (a repo added by mistake): out of the manifest, its docs and its clone
 * deleted. Other repos' dependencies on it are kept and reported, as spec 6 asks. Refuses to
 * delete a clone with work not on a remote unless `force`, and never deletes a path outside
 * the hub. Idempotent: the files go first and the manifest last, so a run that stopped half
 * way is finished by the next one, and a repo no longer in the manifest is not an error.
 */
export function removeRepo(hub: string, name: string, opts: { force?: boolean } = {}): { removed: boolean; dependents: Repo[]; clone?: string } {
  const m = loadManifest(hub);
  const repo = m.repos.find((r) => r.name === name);
  if (!repo) return { removed: false, dependents: [] };
  const dir = repoPath(hub, repo);
  const rel = relative(hub, dir);
  const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  if (existsSync(dir) && inside && !opts.force) {
    const why = unsafeToDelete(dir);
    if (why) throw new ManifestError(`${why} (${repo.path}): envie ou descarte o trabalho, ou use --force`);
  }
  const deps = dependents(m, name);
  rmSync(docsDir(hub, name), { recursive: true, force: true });
  rmSync(archivedDocsDir(hub, name), { recursive: true, force: true });
  let clone: string | undefined;
  if (existsSync(dir) && inside) {
    rmSync(dir, { recursive: true, force: true });
    clone = repo.path;
  }
  m.repos = m.repos.filter((r) => r.name !== name);
  saveManifest(hub, m);
  updateOverview(hub, m);
  return { removed: true, dependents: deps, ...(clone ? { clone } : {}) };
}

export interface RepoStatus {
  repo: string;
  state: "em dia" | "desatualizada" | "sem docs" | "não clonado" | "arquivado";
  documented?: string;
  /** The working branch's latest commit, on the remote when it could be fetched. */
  current?: string;
  /** Commits between the documented one and the current one, when Git knows both. */
  behind?: number;
  /** Things to know: the remote could not be reached, the clone needs a sync. */
  notes: string[];
}

/** The latest commit of the repo's working branch: fetched from the remote, else the last one known. */
function latest(dir: string, branch: string): { commit?: string; fetched: boolean } {
  const fetched = git(dir, "fetch", "-q", "origin", branch).ok;
  const remote = git(dir, "rev-parse", "--verify", "-q", `refs/remotes/origin/${branch}`);
  if (remote.ok) return { commit: remote.out.trim(), fetched };
  const local = git(dir, "rev-parse", "--verify", "-q", `refs/heads/${branch}`);
  return { ...(local.ok ? { commit: local.out.trim() } : {}), fetched };
}

/**
 * `hub status`: repos whose working branch, as it is on the remote, differs from the commit
 * the docs describe. Comparing with the remote shows merged PRs before any sync (spec 9.1).
 */
export function status(hub: string): RepoStatus[] {
  return loadManifest(hub).repos.map((r): RepoStatus => {
    if (r.status === "archived") return { repo: r.name, state: "arquivado", notes: [] };
    const dir = repoPath(hub, r);
    if (!isClone(dir)) return { repo: r.name, state: "não clonado", notes: [] };
    const { commit: current, fetched } = latest(dir, r.branch);
    const notes: string[] = [];
    if (!fetched) notes.push(`sem acesso ao remote: comparado com o último ${r.branch} conhecido`);
    const branch = currentBranch(dir);
    const local = head(dir);
    if (branch !== r.branch) notes.push(`o clone está na branch ${branch}`);
    else if (current && local !== current) notes.push(`o clone não está em dia com origin/${r.branch}`);
    if (notes.some((n) => n.startsWith("o clone"))) notes.push("rode `hubspec hub sync` antes de documentar");
    const meta = readMeta(docsDir(hub, r.name));
    if (!meta) return { repo: r.name, state: "sem docs", ...(current ? { current } : {}), notes };
    if (meta.branch !== r.branch) notes.push(`as docs descrevem a branch ${meta.branch}; a branch de trabalho agora é ${r.branch}`);
    if (meta.commit === current) return { repo: r.name, state: "em dia", documented: meta.commit, current, notes };
    const count = current ? git(dir, "rev-list", "--count", `${meta.commit}..${current}`) : undefined;
    return { repo: r.name, state: "desatualizada", documented: meta.commit, ...(current ? { current } : {}), ...(count?.ok ? { behind: Number(count.out.trim()) } : {}), notes };
  });
}
