import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";

export const MANIFEST = "repos.yaml";
export const WORKSPACE = "workspace";

/** A dependency of one repo on another; `via` says how (an API, an event, a package). */
export interface Dependency {
  repo: string;
  via?: string;
  /** Who declared it: the user (`manual`) or the agent while documenting (`llm`). */
  source?: "manual" | "llm";
}

export interface Repo {
  name: string;
  /** GitHub URL, HTTPS or SSH. */
  url: string;
  branch: string;
  /** Local clone, relative to the hub. */
  path: string;
  description?: string;
  tags: string[];
  dependsOn: Dependency[];
  status: "active" | "archived";
  /** Changes this repo was created for (`hub add --new --change`). */
  changes?: string[];
  /** Created from the organization's template: the change must not recreate its structure. */
  template?: boolean;
}

export interface Manifest {
  version: 1;
  repos: Repo[];
}

const DependencyIn = z.union([
  z.string().min(1),
  z.object({ repo: z.string().min(1), via: z.string().optional(), source: z.enum(["manual", "llm"]).optional() }),
]);

const RepoIn = z.object({
  name: z.string().regex(/^[A-Za-z0-9._-]+$/, "use letras, números, ponto, hífen ou sublinhado"),
  url: z.string().min(1),
  branch: z.string().min(1).default("main"),
  path: z.string().min(1).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  dependsOn: z.array(DependencyIn).default([]),
  status: z.enum(["active", "archived"]).default("active"),
  changes: z.array(z.string()).optional(),
  template: z.boolean().optional(),
});

const ManifestIn = z.object({ version: z.literal(1).default(1), repos: z.array(RepoIn).default([]) });

/** A manifest the user can fix: the message says where. */
export class ManifestError extends Error {
  override readonly name = "ManifestError";
}

/** The hub: the nearest folder, from `cwd` up, with a repos.yaml. */
export function findHub(cwd: string): string | undefined {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, MANIFEST)) && statSync(join(dir, MANIFEST)).isFile()) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

export function requireHub(cwd: string): string {
  const hub = findHub(cwd);
  if (!hub) throw new ManifestError(`nenhum ${MANIFEST} encontrado a partir daqui: rode \`hubspec hub init\` na raiz do hub`);
  return hub;
}

function normalize(dep: z.infer<typeof DependencyIn>): Dependency {
  return typeof dep === "string" ? { repo: dep } : { repo: dep.repo, ...(dep.via ? { via: dep.via } : {}), ...(dep.source ? { source: dep.source } : {}) };
}

export function parseManifest(text: string): Manifest {
  let raw: unknown;
  try {
    raw = parse(text) ?? {};
  } catch (err) {
    throw new ManifestError(`${MANIFEST} não é YAML válido: ${(err as Error).message}`);
  }
  const checked = ManifestIn.safeParse(raw);
  if (!checked.success) {
    const issue = checked.error.issues[0]!;
    throw new ManifestError(`${MANIFEST}: ${issue.path.join(".")}: ${issue.message}`);
  }
  const repos = checked.data.repos.map(
    (r): Repo => ({
      name: r.name,
      url: r.url,
      branch: r.branch,
      path: r.path ?? `${WORKSPACE}/${r.name}`,
      ...(r.description ? { description: r.description } : {}),
      tags: r.tags,
      dependsOn: r.dependsOn.map(normalize),
      status: r.status,
      ...(r.changes?.length ? { changes: r.changes } : {}),
      ...(r.template ? { template: true } : {}),
    }),
  );
  const seen = new Set<string>();
  for (const r of repos) {
    if (seen.has(r.name)) throw new ManifestError(`${MANIFEST}: o repo ${r.name} aparece duas vezes`);
    seen.add(r.name);
  }
  return { version: 1, repos };
}

export function loadManifest(hub: string): Manifest {
  return parseManifest(readFileSync(join(hub, MANIFEST), "utf8"));
}

const HEADER = `# Repositórios do sistema. Editado pelo hubspec (hub add, depends, archive, remove), mas pode ser editado à mão.
# Campos: name, url, branch, path, description, tags, dependsOn (repo, via, source), status (active | archived).
`;

export function renderManifest(m: Manifest): string {
  const repos = m.repos.map((r) => ({
    name: r.name,
    url: r.url,
    branch: r.branch,
    path: r.path,
    ...(r.description ? { description: r.description } : {}),
    tags: r.tags,
    // A plain manual dependency stays a plain name; one with details, or from the agent, is an object.
    dependsOn: r.dependsOn.map((d) => (d.via || d.source === "llm" ? d : d.repo)),
    status: r.status,
    ...(r.changes?.length ? { changes: r.changes } : {}),
    ...(r.template ? { template: true } : {}),
  }));
  return HEADER + stringify({ version: 1, repos }, { lineWidth: 0 });
}

export function saveManifest(hub: string, m: Manifest): void {
  writeFileSync(join(hub, MANIFEST), renderManifest(m));
}

export function findRepo(m: Manifest, name: string): Repo {
  const repo = m.repos.find((r) => r.name === name);
  if (!repo) throw new ManifestError(`o repo ${name} não está no ${MANIFEST} (repos: ${m.repos.map((r) => r.name).join(", ") || "nenhum"})`);
  return repo;
}

export function repoPath(hub: string, repo: Repo): string {
  return isAbsolute(repo.path) ? repo.path : join(hub, repo.path);
}

/** The repo name a GitHub URL points to: `https://github.com/org/api.git` → `api`. */
export function nameFromUrl(url: string): string {
  const name = url.replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop() ?? "";
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new ManifestError(`não consegui tirar o nome do repo de ${url}: use --name`);
  return name;
}

/** Active repos that still declare a dependency on `name`. */
export function dependents(m: Manifest, name: string): Repo[] {
  return m.repos.filter((r) => r.name !== name && r.status === "active" && r.dependsOn.some((d) => d.repo === name));
}

/**
 * Repos with their dependencies first (Kahn's algorithm). Ties keep the manifest order; a
 * cycle keeps its repos in manifest order at the end.
 */
export function dependencyOrder(repos: readonly Repo[]): Repo[] {
  const names = new Set(repos.map((r) => r.name));
  const pending = new Map(repos.map((r) => [r.name, new Set(r.dependsOn.map((d) => d.repo).filter((d) => names.has(d) && d !== r.name))]));
  const out: Repo[] = [];
  while (out.length < repos.length) {
    const next = repos.find((r) => pending.has(r.name) && pending.get(r.name)!.size === 0) ?? repos.find((r) => pending.has(r.name))!;
    out.push(next);
    pending.delete(next.name);
    for (const deps of pending.values()) deps.delete(next.name);
  }
  return out;
}
