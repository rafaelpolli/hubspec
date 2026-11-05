import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentBranch, git, head, isClone, isDirty } from "./git.ts";
import { findRepo, loadManifest, repoPath, type Manifest, type Repo } from "./manifest.ts";
import { scanRepo } from "./scan.ts";

export const DOCS = "docs";
export const OVERVIEW = `${DOCS}/system-overview.md`;
export const DOC_FILES = ["overview.md", "architecture.md", "interfaces.md"] as const;
export const SCAN_FILE = ".scan.json";
export const META_FILE = ".meta.json";
/** A section of a template the agent has not filled yet. */
export const TODO = "<!-- hubspec:preencher -->";
const MAP_START = "<!-- hubspec:mapa:inicio -->";
const MAP_END = "<!-- hubspec:mapa:fim -->";

export interface Meta {
  repo: string;
  commit: string;
  branch: string;
  documentedAt: string;
}

export const docsDir = (hub: string, repo: string) => join(hub, DOCS, "repos", repo);
export const archivedDocsDir = (hub: string, repo: string) => join(hub, DOCS, "archive", repo);

const section = (title: string, hint: string) => [`## ${title}`, "", TODO, `_${hint}_`, ""];

/** The fixed templates (spec 7): the same sections in every repo, for consistent docs. */
export function templates(repo: Repo): Record<(typeof DOC_FILES)[number], string> {
  const head = (title: string) => [`# ${repo.name}: ${title}`, "", `> Gerado com \`hubspec hub document\`; revise antes de commitar. Fonte: ${repo.url}`, ""];
  return {
    "overview.md": [
      ...head("visão geral"),
      ...section("Propósito", "o que este repo faz no sistema e para quem, em um parágrafo"),
      ...section("Stack", "linguagens, frameworks, banco e infraestrutura (ver .scan.json)"),
      ...section("Como rodar", "pré-requisitos, instalar, rodar local e rodar os testes"),
      ...section("Dependências entre repos", "de quais repos do hub este depende e quais dependem dele, e por onde (API, evento, pacote)"),
    ].join("\n"),
    "architecture.md": [
      ...head("arquitetura"),
      ...section("Componentes", "as peças principais e a responsabilidade de cada uma"),
      ...section("Módulos e pastas", "uma linha por pasta relevante da árvore do .scan.json"),
      ...section("Fluxos principais", "os caminhos de ponta a ponta mais importantes, passo a passo"),
    ].join("\n"),
    "interfaces.md": [
      ...head("interfaces"),
      ...section("APIs expostas", "endpoints com método, caminho e para que servem (ver endpoints do .scan.json)"),
      ...section("Eventos", "o que publica e o que consome: tópico/fila, payload e quando"),
      ...section("Contratos", "arquivos OpenAPI, AsyncAPI, protobuf ou GraphQL e o que definem"),
      ...section("Dependências externas", "outros repos do hub, serviços de terceiros e bancos que ele chama"),
    ].join("\n"),
  };
}

const OVERVIEW_TEMPLATE = [
  "# Visão do sistema",
  "",
  "> Mantido com `hubspec hub document`. O mapa abaixo é gerado do repos.yaml; o resto é escrito pelo agente e revisado por você.",
  "",
  ...section("O sistema", "o que o sistema faz, para quem, e como as peças se dividem"),
  ...section("Fluxos entre repos", "os fluxos que atravessam mais de um repo, na ordem em que passam por eles"),
  "## Mapa",
  "",
  MAP_START,
  MAP_END,
  "",
].join("\n");

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n+/g, " ");

/** The map of the system (spec 4, 6): generated from the manifest, never edited by hand. */
export function renderMap(m: Manifest): string {
  const active = m.repos.filter((r) => r.status === "active");
  const archived = m.repos.filter((r) => r.status === "archived");
  const deps = (r: Repo) =>
    r.dependsOn.map((d) => `${d.repo}${d.via ? ` (${cell(d.via)})` : ""}${d.source === "llm" ? " ¹" : ""}`).join(", ") || "-";
  const lines = [MAP_START, ""];
  if (active.length === 0) lines.push("Nenhum repo ativo no repos.yaml.", "");
  else {
    lines.push("| Repo | Descrição | Tags | Depende de | Docs |", "|---|---|---|---|---|");
    for (const r of active) lines.push(`| ${r.name} | ${cell(r.description ?? "-")} | ${r.tags.join(", ") || "-"} | ${deps(r)} | [docs](repos/${r.name}/overview.md) |`);
    lines.push("");
  }
  if (m.repos.some((r) => r.dependsOn.some((d) => d.source === "llm"))) lines.push("¹ dependência identificada pelo agente ao documentar; confira.", "");
  const edges = active.flatMap((r) => r.dependsOn.map((d) => `  ${r.name.replace(/\W/g, "_")} -->${d.via ? `|${d.via.replace(/[|"]/g, "")}|` : ""} ${d.repo.replace(/\W/g, "_")}`));
  if (edges.length > 0) lines.push("```mermaid", "graph LR", ...edges, "```", "");
  if (archived.length > 0) {
    lines.push("### Repos aposentados", "", ...archived.map((r) => `- ${r.name}${r.description ? `: ${r.description}` : ""} — aposentado; docs em [archive/${r.name}](archive/${r.name}/overview.md)`), "");
  }
  lines.push(MAP_END);
  return lines.join("\n");
}

/** Writes the map into system-overview.md, creating the file from its template when missing. */
export function updateOverview(hub: string, m: Manifest = loadManifest(hub)): void {
  const file = join(hub, OVERVIEW);
  mkdirSync(join(hub, DOCS), { recursive: true });
  let text = existsSync(file) ? readFileSync(file, "utf8") : OVERVIEW_TEMPLATE;
  const start = text.indexOf(MAP_START);
  const end = text.indexOf(MAP_END);
  if (start < 0 || end < start) text = `${text.replace(/\s*$/, "")}\n\n## Mapa\n\n${MAP_START}\n${MAP_END}\n`;
  const s = text.indexOf(MAP_START);
  const e = text.indexOf(MAP_END) + MAP_END.length;
  writeFileSync(file, text.slice(0, s) + renderMap(m) + text.slice(e));
}

export function readMeta(dir: string): Meta | undefined {
  const file = join(dir, META_FILE);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Meta) : undefined;
}

export interface Prepared {
  repo: string;
  dir: string;
  commit: string;
  /** The clone has uncommitted changes, which the scan sees but the commit does not have. */
  dirty: boolean;
  /** Docs files still with sections to fill. */
  todo: string[];
  /** The docs already described this commit. */
  current: boolean;
}

/**
 * The active repos asked for (all when none), each cloned and on its default branch, not
 * behind the last fetched remote: the docs describe the default branch, not a change's.
 */
function targets(hub: string, m: Manifest, names: readonly string[]): Repo[] {
  const repos = names.length > 0 ? names.map((n) => findRepo(m, n)) : m.repos.filter((r) => r.status === "active");
  for (const r of repos) {
    const dir = repoPath(hub, r);
    if (r.status !== "active") throw new Error(`o repo ${r.name} está arquivado; as docs dele estão em docs/archive/`);
    if (!isClone(dir)) throw new Error(`o repo ${r.name} não está clonado em ${r.path}: rode \`hubspec hub sync\``);
    const branch = currentBranch(dir);
    if (branch !== r.branch) throw new Error(`o clone de ${r.name} está na branch ${branch}, não em ${r.branch}: rode \`hubspec hub sync\` para voltar à branch padrão`);
    const behind = git(dir, "rev-list", "--count", `HEAD..refs/remotes/origin/${r.branch}`);
    if (behind.ok && Number(behind.out.trim()) > 0) throw new Error(`o clone de ${r.name} está atrás de origin/${r.branch}: rode \`hubspec hub sync\``);
  }
  return repos;
}

/**
 * `hub document [repos]`, the script part: scans each repo into `.scan.json`, creates the
 * templates that are missing (filled ones are kept) and updates the map. The agent then
 * writes the docs and runs `hub document --done`.
 */
export function prepare(hub: string, names: readonly string[] = []): Prepared[] {
  const m = loadManifest(hub);
  const out = targets(hub, m, names).map((repo) => {
    const src = repoPath(hub, repo);
    const dir = docsDir(hub, repo.name);
    mkdirSync(dir, { recursive: true });
    const commit = head(src) ?? "";
    const scan = { repo: repo.name, commit, branch: currentBranch(src), scannedAt: new Date().toISOString(), ...scanRepo(src) };
    writeFileSync(join(dir, SCAN_FILE), `${JSON.stringify(scan, null, 2)}\n`);
    const tpl = templates(repo);
    for (const f of DOC_FILES) if (!existsSync(join(dir, f))) writeFileSync(join(dir, f), tpl[f]);
    const todo = DOC_FILES.filter((f) => readFileSync(join(dir, f), "utf8").includes(TODO));
    return { repo: repo.name, dir, commit, dirty: isDirty(src), todo, current: readMeta(dir)?.commit === commit };
  });
  updateOverview(hub, m);
  return out;
}

/**
 * `hub document --done [repos]`: records what was documented (spec 9: the source commit) in
 * `.meta.json`. Refuses while a repo's doc or the system overview still has a section to fill.
 */
export function finish(hub: string, names: readonly string[] = []): Meta[] {
  const m = loadManifest(hub);
  const repos = targets(hub, m, names);
  for (const repo of repos) {
    const dir = docsDir(hub, repo.name);
    const todo = DOC_FILES.filter((f) => !existsSync(join(dir, f)) || readFileSync(join(dir, f), "utf8").includes(TODO));
    if (todo.length > 0) throw new Error(`${repo.name}: ainda há seções a preencher em ${todo.join(", ")} (procure ${TODO})`);
  }
  const overview = join(hub, OVERVIEW);
  if (!existsSync(overview) || readFileSync(overview, "utf8").includes(TODO)) {
    throw new Error(`${OVERVIEW}: ainda há seções a preencher ("O sistema", "Fluxos entre repos"; procure ${TODO})`);
  }
  const metas = repos.map((repo) => {
    const src = repoPath(hub, repo);
    const meta: Meta = { repo: repo.name, commit: head(src) ?? "", branch: currentBranch(src), documentedAt: new Date().toISOString() };
    writeFileSync(join(docsDir(hub, repo.name), META_FILE), `${JSON.stringify(meta, null, 2)}\n`);
    return meta;
  });
  updateOverview(hub, m);
  return metas;
}
