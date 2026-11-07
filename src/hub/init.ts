import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { InitCommand } from "../openspec/core/init.ts";
import { installHubspecSkills } from "../setup.ts";
import { ADAPTER_TOOLS } from "./agents.ts";
import { DOCS, updateOverview } from "./document.ts";
import { gitProtocol, isShortRepo, repoUrl } from "./github.ts";
import { MANIFEST, loadManifest, ManifestError, saveManifest, WORKSPACE } from "./manifest.ts";
import { addRepo, checkBranchName, setHubBranch, type AddResult } from "./repos.ts";
import { parseRepoList, type ListedRepo } from "./repolist.ts";

/** The tools a hub is set up for when `--tools` is not given. */
export const HUB_TOOLS = ADAPTER_TOOLS.join(",");

export interface InitOptions {
  /** `--tools` of `hubspec init`: tool ids, "all" or "none". */
  tools: string;
  /** URLs or `owner/repo`. */
  repos?: string[];
  /** A text document listing the repos, one per line (`parseRepoList`). */
  reposFile?: string;
  /** The hub's working branch (`setHubBranch`); without it, each repo's remote default. */
  branch?: string;
  log: (line: string) => void;
}

/** Adds `workspace/` to the hub's .gitignore once. */
function ignoreWorkspace(hub: string): void {
  const file = join(hub, ".gitignore");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (text.split("\n").some((l) => l.trim() === `${WORKSPACE}/` || l.trim() === WORKSPACE || l.trim() === `/${WORKSPACE}/`)) return;
  writeFileSync(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}# Clones locais dos repositórios do hub (hubspec hub sync)\n${WORKSPACE}/\n`);
}

/** The repos to register: those given on the command line, then those of the file. */
function listed(opts: InitOptions, cwd: string): ListedRepo[] {
  const out: ListedRepo[] = (opts.repos ?? []).map((spec) => ({ spec }));
  if (opts.reposFile) {
    const file = resolve(cwd, opts.reposFile);
    if (!existsSync(file)) throw new ManifestError(`o arquivo ${opts.reposFile} não existe`);
    const found = parseRepoList(readFileSync(file, "utf8"));
    if (found.length === 0) throw new ManifestError(`nenhum repo encontrado em ${opts.reposFile}: use uma URL ou dono/repo por linha`);
    out.push(...found);
  }
  return out;
}

/**
 * `hub init` (spec 6, 9.0): the hub's structure, repos.yaml, AGENTS.md, docs/, openspec/ with
 * the agents' skills, commands and the hub's rules, and the repos given or listed in a file.
 * Idempotent: an existing hub keeps its manifest and docs; only a new `--branch` changes it.
 */
export async function initHub(hub: string, opts: InitOptions): Promise<AddResult[]> {
  const { log } = opts;
  const repos = listed(opts, process.cwd()); // a missing or empty list fails before anything is written
  if (opts.branch) checkBranchName(process.cwd(), opts.branch);
  mkdirSync(join(hub, DOCS, "repos"), { recursive: true });
  mkdirSync(join(hub, WORKSPACE), { recursive: true });
  ignoreWorkspace(hub);
  if (!existsSync(join(hub, MANIFEST))) {
    saveManifest(hub, { version: 1, repos: [] });
    log(`criado ${MANIFEST}`);
  } else loadManifest(hub); // fails early on a broken manifest
  if (opts.branch) {
    const { changed, moved } = setHubBranch(hub, opts.branch);
    if (changed) log(`branch de trabalho do hub: ${opts.branch}`);
    for (const r of moved) log(`  ${r.name}: ${r.from} → ${opts.branch}`);
    if (moved.length > 0) log(`  um repo que trabalha em outra branch: \`hubspec hub add <url> --branch <branch>\``);
  }

  // The OpenSpec init, then hubspec's skills and, the manifest being there, the adapters.
  await new InitCommand({ tools: opts.tools, animation: false, copilotCloud: false }).execute(hub);
  installHubspecSkills(hub, log);

  // `owner/repo` takes the machine's protocol (gh's git_protocol), asked once.
  let protocol: "ssh" | "https" | undefined;
  const proto = () => (protocol ??= gitProtocol());
  const added = repos.map((r) => addRepo(hub, isShortRepo(r.spec) ? repoUrl(r.spec, proto) : r.spec, r.description ? { description: r.description } : {}));
  for (const a of added) {
    log(`${a.existed ? "já estava" : "registrado"}: ${a.repo.name} (${a.repo.url}, branch ${a.repo.branch})`);
    if (a.warning) log(`  atenção: ${a.warning}`);
  }
  updateOverview(hub);
  return added;
}
