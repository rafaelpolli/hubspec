import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse, parseDocument } from "yaml";

setDefaultTimeout(120_000);

// The 9.1 example (Pix across api, worker and front) and the 9.2 one (a repo created by the
// organization's automation), through the built CLI under Node, with local Git remotes and a fake gh.
const dir = mkdtempSync(join(tmpdir(), "hubspec-hub-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const CLI = resolve(import.meta.dir, "..", "dist", "cli.js");
const home = join(dir, "home");
const bin = join(dir, "bin");
const gh = join(dir, "gh");
const remotes = join(dir, "remotes");
const hub = join(dir, "hub");
const GIT = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const ENV = { ...process.env, ...GIT, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"), PATH: `${bin}:${process.env["PATH"]}`, FAKE_GH_DIR: gh, NO_COLOR: "1" };

function run(env: Record<string, string>, cwd: string, ...args: string[]) {
  const res = Bun.spawnSync(["node", CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...ENV, ...env } });
  return { code: res.exitCode, out: res.stdout.toString(), err: res.stderr.toString() };
}
const hubspec = (cwd: string, ...args: string[]) => run({}, cwd, ...args);

function git(cwd: string, ...args: string[]): string {
  const res = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: ENV });
  if (res.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr.toString()}`);
  return res.stdout.toString().trim();
}

/** A bare remote with one commit of `files`. Returns its URL (`file://`). */
function remote(name: string, files: Record<string, string>): string {
  const work = join(dir, "seed", name);
  mkdirSync(work, { recursive: true });
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(work, f, ".."), { recursive: true });
    writeFileSync(join(work, f), text);
  }
  git(work, "init", "-q", "-b", "main");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "inicial");
  const path = join(remotes, `${name}.git`);
  git(dir, "clone", "-q", "--bare", work, path);
  return `file://${path}`;
}

/** Commits a change straight to a remote's main, as a merged PR would. */
function mergeOnRemote(url: string, name: string, fn: (work: string) => void): void {
  const work = join(dir, "merge", `${name}-${Date.now()}`);
  git(dir, "clone", "-q", url, work);
  fn(work);
  git(work, "push", "-q", "origin", "main");
}

const read = (path: string) => readFileSync(join(hub, path), "utf8");
type ManifestRepo = { name: string; url: string; description?: string; dependsOn: unknown[]; status: string; template?: boolean; changes?: string[] };
const manifest = (at = hub) => parse(readFileSync(join(at, "repos.yaml"), "utf8")) as { repos: ManifestRepo[] };
const repo = (name: string) => manifest().repos.find((r) => r.name === name)!;
const prs = () => JSON.parse(readFileSync(join(gh, "prs.json"), "utf8")) as { repo: string; url: string; base: string; head: string; title: string; body: string }[];
const fillTodos = (path: string) => writeFileSync(path, readFileSync(path, "utf8").replaceAll("<!-- hubspec:preencher -->\n", ""));
let urls: Record<string, string>;

beforeAll(() => {
  for (const d of [home, bin, gh, remotes, hub]) mkdirSync(d, { recursive: true });
  copyFileSync(resolve(import.meta.dir, "fake-gh.mjs"), join(bin, "gh"));
  chmodSync(join(bin, "gh"), 0o755);
  urls = {
    api: remote("api", {
      "package.json": JSON.stringify({ name: "api", dependencies: { express: "^4" }, scripts: { test: "bun test" } }),
      "src/server.ts": 'import express from "express";\nconst app = express();\napp.get("/pagamentos", (_q, r) => r.json([]));\napp.post("/pagamentos/:id/estorno", (_q, r) => r.end());\n',
      "openapi.yaml": "openapi: 3.0.0\ninfo:\n  title: api\n",
      Dockerfile: "FROM node:22\n",
    }),
    worker: remote("worker", { "go.mod": "module acme/worker\n\nrequire github.com/segmentio/kafka-go v0.4.0\n", "main.go": "package main\n" }),
    front: remote("front", { "package.json": JSON.stringify({ name: "front", dependencies: { react: "^18" } }), "src/App.tsx": "export const App = () => null;\n" }),
  };
});

describe("bootstrap de um hub (9.0)", () => {
  test("hub init --repos-file: um documento de texto com a lista; estrutura, AGENTS.md, CLAUDE.md, regras no config.yaml e comandos", () => {
    git(hub, "init", "-q", "-b", "main");
    writeFileSync(
      join(dir, "repos.md"),
      [
        "# Repositórios do sistema de pagamentos",
        "",
        "Lista para o hub. Os três são do time de pagamentos; a documentação fica em docs/overview.md.",
        "",
        `- ${urls.api} — API de pagamentos`,
        `- [worker](${urls.worker}): processa eventos`,
        `* <${urls.front}>`,
        "",
      ].join("\n"),
    );
    const res = hubspec(hub, "hub", "init", "--repos-file", join(dir, "repos.md"));
    expect(res.code).toBe(0);
    expect(manifest().repos.map((r) => [r.name, r.description])).toEqual([
      ["api", "API de pagamentos"],
      ["worker", "processa eventos"],
      ["front", undefined],
    ]);
    expect(parse(read("repos.yaml")).repos[0]).toMatchObject({ url: urls.api, branch: "main", path: "workspace/api", status: "active" });

    const agents = read("AGENTS.md");
    for (const h of ["## 1. O que é o hub", "## 2. Como se orientar", "## 3. Regras para changes", "## 4. Comandos"]) expect(agents).toContain(h);
    expect(read("CLAUDE.md")).toContain("\n@AGENTS.md\n");
    const config = parse(read("openspec/config.yaml"));
    expect(config.schema).toBe("spec-driven");
    expect(config.context).toContain("Este repositório é o hub de um sistema multi-repo");
    expect(config.rules.tasks).toHaveLength(3);
    expect(config.rules.tasks.every((r: string) => r.startsWith("Hub:"))).toBe(true);
    expect(config.rules.proposal[0]).toContain("em quais repos do repos.yaml");

    expect(read(".gitignore")).toContain("workspace/");
    expect(read("docs/system-overview.md")).toContain("| api | API de pagamentos | - | - | [docs](repos/api/overview.md) |");
    for (const f of [
      ".claude/commands/hub/pr.md",
      ".opencode/commands/hub-sync.md",
      ".github/prompts/hub-document.prompt.md",
      ".github/copilot-instructions.md",
      ".devin/workflows/hub-status.md",
      ".devin/playbooks/hub-pr.devin.md",
      ".devin/knowledge/hub.md",
    ]) {
      expect(existsSync(join(hub, f))).toBe(true);
    }
    expect(read(".devin/playbooks/hub-pr.devin.md")).toContain("## Procedure\n\n1. Leia o AGENTS.md na raiz do hub.");
    expect(read(".claude/commands/hub/pr.md")).toContain("Change: $ARGUMENTS");
    for (const s of ["hubspec-document", "hubspec-hub", "openspec-propose"]) expect(existsSync(join(hub, ".claude", "skills", s, "SKILL.md"))).toBe(true);
  });

  test("de novo: idempotente, e mantém o que o usuário escreveu no AGENTS.md e no config.yaml", () => {
    const before = read("repos.yaml");
    writeFileSync(join(hub, "AGENTS.md"), `# Notas do time\n\nNão apague.\n\n${read("AGENTS.md")}`);
    const config = parseDocument(read("openspec/config.yaml"));
    config.set("context", `Contexto do time: usamos Go e TypeScript.\n\n${config.get("context")}`);
    config.setIn(["rules", "tasks"], config.createNode(["Regra do time: tasks curtas.", ...(config.getIn(["rules", "tasks"]) as { toJSON(): string[] }).toJSON()]));
    writeFileSync(join(hub, "openspec/config.yaml"), config.toString());
    const res = hubspec(hub, "hub", "init", "--repos-file", join(dir, "repos.md"), "--tools", "claude");
    expect(res.code).toBe(0);
    expect(res.out).toContain("já estava: api");
    expect(read("repos.yaml")).toBe(before);
    expect(read("AGENTS.md").match(/# Hub do sistema/g)).toHaveLength(1);
    expect(read("AGENTS.md")).toStartWith("# Notas do time");
    const after = parse(read("openspec/config.yaml"));
    expect(after.context).toStartWith("Contexto do time: usamos Go e TypeScript.");
    expect(after.context.match(/hubspec:inicio/g)).toHaveLength(1);
    expect(after.rules.tasks[0]).toBe("Regra do time: tasks curtas.");
    expect(after.rules.tasks).toHaveLength(4);
    expect(after.operations.apply.guidance).toHaveLength(3);
    expect(read("openspec/config.yaml")).toContain("# Per-artifact rules (optional)"); // OpenSpec's own comments stay
  });

  test("arquivo inexistente ou sem repos falha antes de escrever; --org não existe mais", () => {
    const empty = join(dir, "vazio");
    mkdirSync(empty);
    writeFileSync(join(dir, "nada.txt"), "# Nenhum repo aqui\n\nSó texto.\n");
    expect(hubspec(empty, "hub", "init", "--repos-file", "nao-existe.txt").err).toContain("o arquivo nao-existe.txt não existe");
    expect(hubspec(empty, "hub", "init", "--repos-file", join(dir, "nada.txt")).err).toContain("nenhum repo encontrado");
    expect(existsSync(join(empty, "repos.yaml"))).toBe(false);
    expect(hubspec(empty, "hub", "init", "--org", "acme").err).toContain("--org não existe mais");
  });

  test("hub sync clona; de novo fica em dia; um clone com mudanças locais é pulado", () => {
    expect(hubspec(hub, "hub", "sync").out).toBe("api: clonado\nworker: clonado\nfront: clonado\n");
    expect(hubspec(hub, "hub", "sync").out).toBe("api: em dia\nworker: em dia\nfront: em dia\n");
    writeFileSync(join(hub, "workspace/front/rascunho.txt"), "x");
    expect(hubspec(hub, "hub", "sync").out).toContain("front: pulado — há mudanças locais não commitadas");
    rmSync(join(hub, "workspace/front/rascunho.txt"));
    expect(git(hub, "status", "--porcelain")).not.toContain("workspace");
  });

  test("hub document: varredura determinística e templates; --done só com tudo preenchido", () => {
    const res = hubspec(hub, "hub", "document");
    expect(res.code).toBe(0);
    const scan = JSON.parse(read("docs/repos/api/.scan.json"));
    expect(scan).toMatchObject({ repo: "api", commit: git(join(hub, "workspace/api"), "rev-parse", "HEAD"), languages: { TypeScript: 1 }, contracts: ["openapi.yaml"], infra: ["Dockerfile"] });
    expect(scan.manifests[0]).toEqual({ file: "package.json", kind: "npm", name: "api", dependencies: ["express"] });
    expect(scan.endpoints).toEqual([
      { file: "src/server.ts", line: 3, method: "GET", path: "/pagamentos" },
      { file: "src/server.ts", line: 4, method: "POST", path: "/pagamentos/:id/estorno" },
    ]);
    expect(JSON.parse(read("docs/repos/worker/.scan.json")).manifests[0]).toMatchObject({ kind: "go", name: "acme/worker", dependencies: ["github.com/segmentio/kafka-go"] });
    const refused = hubspec(hub, "hub", "document", "--done", "api");
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("api: ainda há seções a preencher em overview.md, architecture.md, interfaces.md");
  });

  test("--done exige também o system-overview preenchido; grava o commit; status em dia", () => {
    for (const r of ["api", "worker", "front"]) for (const f of ["overview.md", "architecture.md", "interfaces.md"]) fillTodos(join(hub, "docs/repos", r, f));
    const overview = hubspec(hub, "hub", "document", "--done");
    expect(overview.code).toBe(1);
    expect(overview.err).toContain('docs/system-overview.md: ainda há seções a preencher ("O sistema", "Fluxos entre repos"');
    fillTodos(join(hub, "docs/system-overview.md"));
    expect(hubspec(hub, "hub", "document", "--done").code).toBe(0);
    expect(JSON.parse(read("docs/repos/api/.meta.json"))).toMatchObject({ repo: "api", branch: "main", commit: git(join(hub, "workspace/api"), "rev-parse", "HEAD") });
    expect(hubspec(hub, "hub", "status")).toMatchObject({ code: 0, out: "api: em dia\nworker: em dia\nfront: em dia\n" });
  });

  test("um merge no remote aparece no status antes do sync (compara com origin/main)", () => {
    mergeOnRemote(urls.api!, "api", (work) => {
      writeFileSync(join(work, "src/novo.ts"), "export {};\n");
      git(work, "add", "-A");
      git(work, "commit", "-q", "-m", "novo");
    });
    const before = hubspec(hub, "hub", "status");
    expect(before.code).toBe(1);
    expect(before.out).toContain("api: desatualizada — documentado");
    expect(before.out).toContain("(1 commit(s) depois)");
    expect(before.out).toContain("  o clone não está em dia com origin/main\n  rode `hubspec hub sync` antes de documentar");
    expect(before.out).toContain("Atualize com: hubspec hub document api");
    expect(hubspec(hub, "hub", "document", "api").err).toContain("o clone de api está atrás de origin/main: rode `hubspec hub sync`");
    expect(hubspec(hub, "hub", "sync").out).toContain("api: atualizado");
    expect(hubspec(hub, "hub", "status").out).not.toContain("rode `hubspec hub sync`");
  });

  test("hub depends: a LLM registra uma dependência; o mapa mostra a origem e o grafo", () => {
    const res = hubspec(hub, "hub", "depends", "worker", "--add", "api", "--via", "evento PagamentoCriado", "--source", "llm");
    expect(res.out).toBe("worker depende de: api (evento PagamentoCriado) [llm]\n");
    hubspec(hub, "hub", "depends", "front", "--set", "api");
    expect(repo("worker").dependsOn).toEqual([{ repo: "api", via: "evento PagamentoCriado", source: "llm" }]);
    expect(repo("front").dependsOn).toEqual(["api"]);
    const overview = read("docs/system-overview.md");
    expect(overview).toContain("| worker | processa eventos | - | api (evento PagamentoCriado) ¹ |");
    expect(overview).toContain("¹ dependência identificada pelo agente ao documentar; confira.");
    expect(overview).toContain("  worker -->|evento PagamentoCriado| api");
    expect(hubspec(hub, "hub", "depends", "worker", "--add", "nao-existe").err).toContain("o repo nao-existe não está no repos.yaml");
  });
});

// front comes before worker in the file, but declares that it depends on worker in this change.
const PIX_TASKS = `## 1. api

- [x] 1.1 [api] Contrato do evento PixRecebido — \`src/events/\`

## 2. front (depende de: worker)

- [ ] 2.1 [front] Tela de pagamento com Pix — \`src/pages/Pagamento.tsx\`

## 3. worker

- [x] 3.1 [worker] Processar PixRecebido — \`internal/pix/\`
`;

describe("change multi-repo e PRs (9.1)", () => {
  test("as regras do hub chegam ao propose e ao apply padrão do OpenSpec (hubspec instructions)", () => {
    const change = join(hub, "openspec/changes/add-pix");
    mkdirSync(change, { recursive: true });
    writeFileSync(join(change, "proposal.md"), "# Pagamento com Pix\n\n## Why\n\nClientes pedem Pix.\n");
    writeFileSync(join(change, "tasks.md"), PIX_TASKS);
    const tasks = JSON.parse(hubspec(hub, "instructions", "tasks", "--change", "add-pix", "--json").out);
    expect(tasks.context).toContain("Este repositório é o hub de um sistema multi-repo");
    expect(tasks.rules.filter((r: string) => r.startsWith("Hub:"))).toHaveLength(3);
    const apply = JSON.parse(hubspec(hub, "instructions", "apply", "--change", "add-pix", "--json").out);
    expect(apply.context).toContain("No apply, implemente cada task dentro de workspace/<repo>/");
    expect(apply.operationGuidance[0]).toStartWith("Hub: implemente cada task dentro de workspace/<repo>/");
  });

  test("hub pr --dry-run: o plano, na ordem das dependências declaradas; front fica de fora com task aberta", () => {
    writeFileSync(join(hub, "workspace/api/src/events.ts"), "export const PIX = 'PixRecebido';\n");
    writeFileSync(join(hub, "workspace/worker/pix.go"), "package main\n");
    const res = hubspec(hub, "hub", "pr", "add-pix", "--dry-run");
    expect(res.out).toBe("api: planejada — branch add-pix → main\nworker: planejada — branch add-pix → main\nfront: pulado — 1 task(s) em aberto: 2.1\n\nOrdem de merge: api → worker\n");
    expect(git(join(hub, "workspace/api"), "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  test("hub pr: branch, commit, push e PR por repo; irmãs e ordem de merge; links nas tasks", () => {
    const res = hubspec(hub, "hub", "pr", "add-pix");
    expect(res.code).toBe(0);
    expect(res.out).toContain("api: aberta https://github.com/acme/api/pull/1");
    expect(res.out).toContain("worker: aberta https://github.com/acme/worker/pull/2");
    expect(git(dir, "--git-dir", join(remotes, "api.git"), "log", "--format=%s", "-1", "add-pix")).toBe("add-pix: Pagamento com Pix");
    const [api, worker] = prs();
    expect(api).toMatchObject({ base: "main", head: "add-pix", title: "Pagamento com Pix" });
    expect(api!.body).toContain("Parte da change `add-pix` do hub (passo 1 de 2).");
    expect(api!.body).toContain("1. api: https://github.com/acme/api/pull/1 ← esta PR\n2. worker: https://github.com/acme/worker/pull/2 (depende de: api)");
    expect(worker!.body).toContain("(passo 2 de 2)");
    expect(worker!.body).toContain("## Proposta\n\n## Why\n\nClientes pedem Pix.");
    const tasks = read("openspec/changes/add-pix/tasks.md");
    expect(tasks).toContain("- [x] 1.1 [api] Contrato do evento PixRecebido — `src/events/` → PR: https://github.com/acme/api/pull/1");
    expect(tasks).toContain("- [x] 3.1 [worker] Processar PixRecebido — `internal/pix/` → PR: https://github.com/acme/worker/pull/2");
    expect(tasks).toContain("- [ ] 2.1 [front] Tela de pagamento com Pix — `src/pages/Pagamento.tsx`\n");
  });

  test("de novo, com front concluído: reaproveita as PRs, abre a do front depois do worker e atualiza as irmãs", () => {
    writeFileSync(join(hub, "workspace/front/src/Pagamento.tsx"), "export const Pagamento = () => null;\n");
    const tasks = join(hub, "openspec/changes/add-pix/tasks.md");
    writeFileSync(tasks, readFileSync(tasks, "utf8").replace("- [ ] 2.1", "- [x] 2.1"));
    const res = hubspec(hub, "hub", "pr", "add-pix");
    expect(res.out).toContain("api: existente https://github.com/acme/api/pull/1");
    expect(res.out).toContain("front: aberta https://github.com/acme/front/pull/3");
    expect(res.out).toContain("Ordem de merge: api → worker → front");
    expect(prs()).toHaveLength(3);
    expect(prs()[0]!.body).toContain("3. front: https://github.com/acme/front/pull/3 (depende de: api, worker)");
    expect(readFileSync(tasks, "utf8").match(/→ PR:/g)).toHaveLength(3);
  });

  test("uma task sem [repo], ou uma dependência declarada que não existe, é recusada", () => {
    const change = join(hub, "openspec/changes/sem-repo");
    mkdirSync(change, { recursive: true });
    writeFileSync(join(change, "tasks.md"), "## 1. Algo\n\n- [x] 1.1 Fazer algo\n");
    expect(hubspec(hub, "hub", "pr", "sem-repo").err).toContain("há tasks sem repo (1.1): toda task começa com [repo] ou [manual]");
    writeFileSync(join(change, "tasks.md"), "## 1. api (depende de: pagamentos)\n\n- [x] 1.1 [api] Algo\n");
    expect(hubspec(hub, "hub", "pr", "sem-repo").err).toContain("mas pagamentos não está no repos.yaml");
  });
});

describe("depois do merge (9.1, passo 6)", () => {
  test("status vê o merge com os clones ainda na branch da change; document recusa; sync volta para main", () => {
    mergeOnRemote(urls.api!, "api", (work) => git(work, "merge", "-q", "--no-ff", "origin/add-pix", "-m", "Merge add-pix"));
    const st = hubspec(hub, "hub", "status");
    expect(st.out).toContain("api: desatualizada");
    expect(st.out).toContain("  o clone está na branch add-pix\n  rode `hubspec hub sync` antes de documentar");
    expect(hubspec(hub, "hub", "document", "api").err).toContain("o clone de api está na branch add-pix, não em main: rode `hubspec hub sync` para voltar à branch padrão");
    const sync = hubspec(hub, "hub", "sync");
    expect(sync.out).toContain("api: atualizado — voltou de add-pix para main");
    expect(sync.out).toContain("worker: em dia — voltou de add-pix para main");
    expect(existsSync(join(hub, "workspace/api/src/events.ts"))).toBe(true);
    expect(hubspec(hub, "hub", "document", "api").code).toBe(0);
  });

  test("um clone numa branch com commits que não estão no remote não volta", () => {
    const front = join(hub, "workspace/front");
    git(front, "checkout", "-q", "-b", "experimento");
    writeFileSync(join(front, "x.ts"), "export {};\n");
    git(front, "add", "-A");
    git(front, "commit", "-q", "-m", "local");
    expect(hubspec(hub, "hub", "sync").out).toContain("front: pulado — está na branch experimento, com 1 commit(s) que não estão no remote");
    git(front, "checkout", "-q", "main");
    git(front, "branch", "-q", "-D", "experimento");
  });
});

describe("verificação no hub: cada teste no seu repo", () => {
  const SPEC = "## ADDED Requirements\n\n### Requirement: Evento Pix\nA api SHALL publicar PixRecebido.\n\n#### Scenario: Nome do evento\n- **WHEN** um Pix chega\n- **THEN** o evento é PixRecebido\n";
  const ID = "pix/Evento Pix/Nome do evento";

  test("o trace aponta o repo; o teste roda no clone; sem repo é evidência inválida; mexer num clone deixa desatualizada", () => {
    const change = join(hub, "openspec/changes/add-pix");
    mkdirSync(join(change, "specs/pix"), { recursive: true });
    writeFileSync(join(change, "specs/pix/spec.md"), SPEC);
    const api = join(hub, "workspace/api");
    writeFileSync(join(api, "src/pix.test.ts"), 'import { expect, test } from "bun:test";\nimport { PIX } from "./events.ts";\n\ntest("evento PixRecebido", () => {\n  expect(PIX).toBe("PixRecebido");\n});\n');
    expect(hubspec(hub, "scenarios", "add-pix", "--template").code).toBe(0);
    expect(JSON.parse(readFileSync(join(change, ".hubspec/trace.json"), "utf8")).items[0]).toMatchObject({ id: ID, repo: "" });
    writeFileSync(join(change, ".hubspec/trace.json"), JSON.stringify({ items: [{ id: ID, kind: "teste", repo: "api", file: "src/pix.test.ts", line: 4, name: "evento PixRecebido" }] }));
    expect(hubspec(hub, "verify", "add-pix").out).toContain("Veredito: PASS");
    expect(read("openspec/changes/add-pix/verification.md")).toContain('`api/src/pix.test.ts:4` "evento PixRecebido" | coberto');
    expect(hubspec(hub, "gate", "add-pix").code).toBe(0);
    writeFileSync(join(hub, "docs/system-overview.md"), `${read("docs/system-overview.md")}\nnota\n`);
    expect(hubspec(hub, "gate", "add-pix").code).toBe(0); // the hub's own docs are not code
    writeFileSync(join(hub, "workspace/worker/extra.go"), "package main\n");
    expect(hubspec(hub, "gate", "add-pix").out).toContain("o código ou os artefatos mudaram depois da verificação");
    writeFileSync(join(change, ".hubspec/trace.json"), JSON.stringify({ items: [{ id: ID, kind: "teste", file: "src/pix.test.ts", line: 4, name: "evento PixRecebido" }] }));
    expect(hubspec(hub, "verify", "add-pix").out).toContain("informe o repo do teste (um destes: api, worker, front)");
    rmSync(join(hub, "workspace/worker/extra.go"));
    rmSync(join(api, "src/pix.test.ts"));
  });
});

describe("repo criado pela automação da organização (9.2)", () => {
  const TASKS = "## 1. Manual\n\n- [ ] 1.1 [manual] Criar repo via issue na automação da organização\n\n## 2. lib-validacao\n\n- [ ] 2.1 [lib-validacao] API pública — `src/index.ts`\n";

  test("a task manual aberta bloqueia o hub pr", () => {
    const change = join(hub, "openspec/changes/criar-lib-validacao");
    mkdirSync(change, { recursive: true });
    writeFileSync(join(change, "tasks.md"), TASKS.replace("## 2. lib-validacao\n\n- [ ] 2.1 [lib-validacao]", "## 2. api\n\n- [x] 2.1 [api]"));
    const res = hubspec(hub, "hub", "pr", "criar-lib-validacao");
    expect(res.code).toBe(1);
    expect(res.err).toContain("a task manual 1.1 ainda está aberta e bloqueia as demais");
    expect(prs()).toHaveLength(3);
  });

  test("hub add --new --change: registra, clona, vincula à change, marca o template e conclui a task manual", () => {
    const change = join(hub, "openspec/changes/criar-lib-validacao");
    writeFileSync(join(change, "tasks.md"), TASKS);
    const url = remote("lib-validacao", { "main.tf": 'module "repo" {}\n', "src/index.ts": "export {};\n" });
    const res = hubspec(hub, "hub", "add", url, "--new", "--change", "criar-lib-validacao", "--depends", "api");
    expect(res.code).toBe(0);
    expect(res.out).toContain("clone: clonado");
    expect(res.out).toContain("task manual concluída: 1.1 Criar repo via issue na automação da organização");
    expect(repo("lib-validacao")).toMatchObject({ template: true, changes: ["criar-lib-validacao"], dependsOn: ["api"] });
    expect(read("openspec/changes/criar-lib-validacao/tasks.md")).toContain("- [x] 1.1 [manual] Criar repo");
    expect(existsSync(join(hub, "workspace/lib-validacao/main.tf"))).toBe(true);
  });
});

describe("aposentar e remover", () => {
  test("hub archive: avisa os dependentes, move as docs, o sync deixa de clonar e o mapa registra", () => {
    const res = hubspec(hub, "hub", "archive", "api");
    expect(res.err).toContain("atenção: worker, front, lib-validacao ainda declara(m) dependência de api");
    expect(repo("api").status).toBe("archived");
    expect(existsSync(join(hub, "docs/archive/api/overview.md"))).toBe(true);
    expect(existsSync(join(hub, "docs/repos/api"))).toBe(false);
    expect(hubspec(hub, "hub", "sync").out).not.toContain("api:");
    expect(hubspec(hub, "hub", "status").out).toContain("api: arquivado");
    expect(read("docs/system-overview.md")).toContain("- api: API de pagamentos — aposentado; docs em [archive/api](archive/api/overview.md)");
    expect(hubspec(hub, "hub", "archive", "api").code).toBe(0);
  });

  test("hub remove: pede --yes; recusa clone com mudanças; só avisa os dependentes; de novo não é erro", () => {
    hubspec(hub, "hub", "depends", "front", "--add", "lib-validacao");
    expect(hubspec(hub, "hub", "remove", "lib-validacao").err).toContain("confirme com --yes");
    writeFileSync(join(hub, "workspace/lib-validacao/wip.ts"), "x");
    const dirty = hubspec(hub, "hub", "remove", "lib-validacao", "--yes");
    expect(dirty.code).toBe(1);
    expect(dirty.err).toContain("o clone tem mudanças não commitadas");
    const res = hubspec(hub, "hub", "remove", "lib-validacao", "--yes", "--force");
    expect(res.out).toContain("lib-validacao: removido do manifesto e das docs; clone workspace/lib-validacao apagado");
    expect(res.err).toContain("atenção: front ainda declara(m) dependência de lib-validacao");
    expect(res.err).toContain("hubspec hub depends front --remove lib-validacao");
    expect(repo("front").dependsOn).toEqual(["api", "lib-validacao"]);
    expect(manifest().repos.map((r) => r.name)).not.toContain("lib-validacao");
    expect(existsSync(join(hub, "workspace/lib-validacao"))).toBe(false);
    expect(hubspec(hub, "hub", "remove", "lib-validacao", "--yes")).toMatchObject({ code: 0, out: "lib-validacao: não está no repos.yaml; nada a remover\n" });
  });
});

describe("dono/repo segue o protocolo do gh (SSH ou HTTPS)", () => {
  test("hub add acme/x vira git@ com git_protocol ssh e https:// sem", () => {
    const other = join(dir, "hub-curto");
    mkdirSync(other);
    expect(hubspec(other, "hub", "init", "--tools", "claude").code).toBe(0);
    expect(run({ FAKE_GH_PROTOCOL: "ssh" }, other, "hub", "add", "acme/novo", "--branch", "main").code).toBe(0);
    expect(hubspec(other, "hub", "add", "acme/outro", "--branch", "main").code).toBe(0);
    expect(manifest(other).repos.map((r) => [r.name, r.url])).toEqual([
      ["novo", "git@github.com:acme/novo.git"],
      ["outro", "https://github.com/acme/outro.git"],
    ]);
  });
});
