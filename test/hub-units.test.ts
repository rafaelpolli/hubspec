import { describe, expect, test } from "bun:test";
import { dependencyOrder, nameFromUrl, parseManifest, renderManifest, type Repo } from "../src/hub/manifest.ts";
import { completeManual, declaredDependencies, linkPr, parseHubTasks, taskRepos } from "../src/hub/tasks.ts";
import { repoUrl } from "../src/hub/github.ts";
import { parseRepoList } from "../src/hub/repolist.ts";

const REPOS = ["api", "worker", "front"];

describe("tasks multi-repo", () => {
  const md = "## 1. Manual\n\n- [ ] 1.1 Criar repo via issue\n\n## 2. api\n\n- [x] 2.1 Contrato — `src/`\n- [ ] 2.2 [worker] Consumir\n\n## 3. Outros\n\n- [ ] 3.1 sem repo\n";

  test("o repo vem do [tag] ou do título da seção; [manual] também pela seção", () => {
    const tasks = parseHubTasks(md, REPOS);
    expect(tasks.map((t) => [t.id, t.repo, t.done])).toEqual([
      ["1.1", "manual", false],
      ["2.1", "api", true],
      ["2.2", "worker", false],
      ["3.1", undefined, false],
    ]);
    expect(taskRepos(tasks)).toEqual(["api", "worker"]);
  });

  test("dependências declaradas no título da seção, e a seção ainda vale como repo das tasks", () => {
    const text = "## 1. api\n\n- [ ] 1.1 Contrato\n\n## 2. front (depende de: worker, [api])\n\n- [ ] 2.1 Tela\n\n## 3. worker (Depends on: api)\n";
    expect(Object.fromEntries(declaredDependencies(text))).toEqual({ front: ["worker", "api"], worker: ["api"] });
    expect(parseHubTasks(text, REPOS).map((t) => t.repo)).toEqual(["api", "front"]);
  });

  test("completeManual marca só a primeira manual aberta; linkPr troca o link anterior", () => {
    const done = completeManual(md, REPOS);
    expect(done.task?.id).toBe("1.1");
    expect(done.markdown).toContain("- [x] 1.1 Criar repo via issue");
    const once = linkPr(md, REPOS, "api", "https://x/1");
    const twice = linkPr(once, REPOS, "api", "https://x/2");
    expect(twice).toContain("- [x] 2.1 Contrato — `src/` → PR: https://x/2\n");
    expect(parseHubTasks(twice, REPOS)[1]!.pr).toBe("https://x/2");
  });
});

describe("lista de repos num documento de texto", () => {
  test("URLs em qualquer formato, dono/repo sozinho na linha; o resto da linha é a descrição; prosa e títulos são ignorados", () => {
    const text = [
      "# Sistema de pagamentos",
      "",
      "Os repos abaixo; a doc geral está em docs/overview.md e o time em acme/handbook.md.",
      "",
      "- https://github.com/acme/api — API de pagamentos",
      "- [x] git@github.com:acme/worker.git: processa eventos",
      "1. [front](https://github.com/acme/front) | tela web",
      "* <https://github.com/acme/infra.git>",
      "acme/lib-validacao - biblioteca de validação",
      "`acme/cli`",
      "docs/overview.md - não é repo",
      "- https://github.com/acme/api (repetido)",
    ].join("\n");
    expect(parseRepoList(text)).toEqual([
      { spec: "https://github.com/acme/api", description: "API de pagamentos" },
      { spec: "git@github.com:acme/worker.git", description: "processa eventos" },
      { spec: "https://github.com/acme/front", description: "tela web" },
      { spec: "https://github.com/acme/infra.git" },
      { spec: "acme/lib-validacao", description: "biblioteca de validação" },
      { spec: "acme/cli" },
    ]);
  });

  test("dono/repo vira URL no protocolo da máquina; URLs ficam como estão", () => {
    expect(repoUrl("acme/api", () => "ssh")).toBe("git@github.com:acme/api.git");
    expect(repoUrl("acme/api.git", () => "https")).toBe("https://github.com/acme/api.git");
    expect(repoUrl("https://github.com/acme/api", () => "ssh")).toBe("https://github.com/acme/api");
  });
});

describe("manifesto", () => {
  const repo = (name: string, deps: string[] = []): Repo => ({ name, url: `u/${name}`, branch: "main", path: `workspace/${name}`, tags: [], dependsOn: deps.map((d) => ({ repo: d })), status: "active" });

  test("ordem de dependência: dependências primeiro, empate na ordem do manifesto, ciclo não trava", () => {
    expect(dependencyOrder([repo("front", ["api"]), repo("worker", ["api"]), repo("api")]).map((r) => r.name)).toEqual(["api", "front", "worker"]);
    expect(dependencyOrder([repo("a", ["b"]), repo("b", ["a"]), repo("c")]).map((r) => r.name)).toEqual(["c", "a", "b"]);
  });

  test("ida e volta do YAML; dependências curtas e com detalhe; erros dizem onde", () => {
    const m = parseManifest("repos:\n  - name: api\n    url: git@github.com:acme/api.git\n  - name: worker\n    url: u\n    dependsOn: [api, { repo: api, via: evento, source: llm }]\n");
    expect(m.repos[0]).toMatchObject({ branch: "main", path: "workspace/api", status: "active", tags: [] });
    expect(parseManifest(renderManifest(m))).toEqual(m);
    expect(() => parseManifest("repos:\n  - url: x\n")).toThrow("repos.yaml: repos.0.name");
    expect(() => parseManifest("repos:\n  - {name: a, url: x}\n  - {name: a, url: y}\n")).toThrow("o repo a aparece duas vezes");
    expect(nameFromUrl("git@github.com:acme/lib-x.git")).toBe("lib-x");
    expect(nameFromUrl("https://github.com/acme/api/")).toBe("api");
  });
});
