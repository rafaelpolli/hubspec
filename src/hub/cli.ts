import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { repoUrl } from "./github.ts";
import { finish, prepare } from "./document.ts";
import { HUB_TOOLS, initHub } from "./init.ts";
import { requireHub } from "./manifest.ts";
import { openPrs } from "./pr.ts";
import { addRepo, archiveRepo, removeRepo, setDependencies, status } from "./repos.ts";
import { sync } from "./sync.ts";

export const HUB_HELP = `Hub multi-repo (rode na raiz do hub):
  hubspec hub init [--repos <url|dono/repo…>] [--repos-file <arquivo>] [--branch <b>] [--tools <ids>|all]
      cria repos.yaml, AGENTS.md, docs/, openspec/ e os comandos dos agentes; o arquivo é
      um texto com um repo por linha (URL ou dono/repo; o resto da linha vira a descrição);
      --branch é a branch de trabalho do hub (num Git Flow, develop): clones, docs e PRs
      partem dela; sem ela, cada repo usa a branch padrão do remote
  hubspec hub add <url|dono/repo> [--name n] [--branch b] [--description t] [--tags a,b]
                  [--depends a,b] [--new --change <change>]   repo recém-criado pela automação
  hubspec hub sync                           clona ou atualiza os repos em workspace/
  hubspec hub document [repos…]              varredura + templates (o agente escreve as docs)
  hubspec hub document --done [repos…]       registra o commit documentado em .meta.json
  hubspec hub depends <repo> [--set a,b] [--add a,b] [--remove a,b] [--via t] [--source llm|manual]
  hubspec hub status                         docs desatualizadas contra o remote (exit 1 se houver)
  hubspec hub pr <change> [--dry-run]        uma PR por repo, com as irmãs e a ordem de merge
  hubspec hub archive <repo>                 aposenta o repo (fica no manifesto como arquivado)
  hubspec hub remove <repo> [--yes] [--force]  tira do manifesto e apaga docs e clone
`;

type Opts = Record<string, string | string[] | true>;

const str = (v: Opts[string] | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? v.join(",") : undefined);
const list = (v: Opts[string] | undefined) => (str(v) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** `--branch <b>`; `--branch` alone is a mistake, not "no branch". */
function branchOpt(opt: Opts): string | undefined {
  if (opt["branch"] === true) throw new Error("--branch precisa do nome da branch (por exemplo --branch develop)");
  return str(opt["branch"]);
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new Error(`falta ${what}; veja \`hubspec hub help\``);
  return value;
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function warnDependents(repo: string, deps: readonly { name: string }[]): void {
  if (deps.length === 0) return;
  console.error(`atenção: ${deps.map((d) => d.name).join(", ")} ainda declara(m) dependência de ${repo}`);
  console.error(`  confira e, se for o caso, tire com: ${deps.map((d) => `hubspec hub depends ${d.name} --remove ${repo}`).join("; ")}`);
}

/** `hubspec hub <command>`; returns the exit code. */
export async function hubCommand(command: string | undefined, pos: string[], opt: Opts, cwd: string): Promise<number> {
  switch (command) {
    case undefined:
    case "help":
      console.log(HUB_HELP);
      return 0;
    case "init": {
      if (opt["org"] !== undefined) throw new Error("--org não existe mais: liste os repos num arquivo de texto e use --repos-file <arquivo>");
      const repos = Array.isArray(opt["repos"]) ? opt["repos"] : list(opt["repos"]);
      const file = str(opt["repos-file"]);
      const branch = branchOpt(opt);
      await initHub(resolve(pos[0] ?? cwd), {
        tools: str(opt["tools"]) ?? HUB_TOOLS,
        repos,
        ...(file ? { reposFile: file } : {}),
        ...(branch ? { branch } : {}),
        log: (l) => console.log(l),
      });
      console.log("\nPróximos passos: `hubspec hub sync`, depois `hubspec hub document` pelo agente (skill hubspec-document).");
      return 0;
    }
    case "add": {
      const url = repoUrl(need(pos[0], "a URL do repo"));
      const change = str(opt["change"]);
      const branch = branchOpt(opt);
      const r = addRepo(requireHub(cwd), url, {
        ...(str(opt["name"]) ? { name: str(opt["name"])! } : {}),
        ...(branch ? { branch } : {}),
        ...(str(opt["description"]) ? { description: str(opt["description"])! } : {}),
        tags: list(opt["tags"]),
        depends: list(opt["depends"]),
        isNew: opt["new"] === true,
        ...(change ? { change } : {}),
      });
      console.log(`${r.existed ? "atualizado" : "registrado"}: ${r.repo.name} (${r.repo.url}, branch ${r.repo.branch})`);
      if (r.warning) console.error(`atenção: ${r.warning}`);
      if (r.sync) console.log(`clone: ${r.sync.action}${r.sync.detail ? ` — ${r.sync.detail}` : ""}`);
      if (r.manualTask) console.log(`task manual concluída: ${r.manualTask.id ?? ""} ${r.manualTask.text}`.replace("  ", " "));
      else if (opt["new"]) console.log("nenhuma task [manual] em aberto na change");
      return r.sync?.action === "falhou" ? 1 : 0;
    }
    case "sync": {
      const results = sync(requireHub(cwd));
      if (results.length === 0) console.log("nenhum repo ativo no repos.yaml");
      for (const r of results) console.log(`${r.repo}: ${r.action}${r.detail ? ` — ${r.detail}` : ""}`);
      return results.some((r) => r.action === "falhou") ? 1 : 0;
    }
    case "document": {
      const hub = requireHub(cwd);
      if (opt["done"]) {
        const done = Array.isArray(opt["done"]) ? opt["done"] : typeof opt["done"] === "string" ? [opt["done"], ...pos] : pos;
        for (const m of finish(hub, done)) console.log(`${m.repo}: documentado em ${m.commit.slice(0, 12)} (${m.branch})`);
        return 0;
      }
      for (const p of prepare(hub, pos)) {
        const state = p.todo.length > 0 ? `a preencher: ${p.todo.join(", ")}` : p.current ? "docs em dia com este commit" : "docs existentes: atualize pelo .scan.json novo";
        console.log(`${p.repo} (${p.commit.slice(0, 12)}): ${state}\n  ${p.dir}`);
        if (p.dirty) console.log("  atenção: o clone tem mudanças não commitadas; a varredura as vê, mas o commit registrado não as tem");
      }
      console.log("\nO agente escreve as docs a partir do .scan.json (skill hubspec-document) e depois roda `hubspec hub document --done`.");
      return 0;
    }
    case "depends": {
      const repo = setDependencies(requireHub(cwd), need(pos[0], "o nome do repo"), {
        ...(opt["set"] !== undefined ? { set: list(opt["set"]) } : {}),
        ...(opt["add"] !== undefined ? { add: list(opt["add"]) } : {}),
        ...(opt["remove"] !== undefined ? { remove: list(opt["remove"]) } : {}),
        ...(str(opt["via"]) ? { via: str(opt["via"])! } : {}),
        ...(str(opt["source"]) ? { source: str(opt["source"]) === "llm" ? "llm" : "manual" } : {}),
      });
      console.log(`${repo.name} depende de: ${repo.dependsOn.map((d) => `${d.repo}${d.via ? ` (${d.via})` : ""}${d.source === "llm" ? " [llm]" : ""}`).join(", ") || "nada"}`);
      return 0;
    }
    case "status": {
      const rows = status(requireHub(cwd));
      for (const r of rows) {
        const extra = r.state === "desatualizada" ? ` — documentado ${r.documented?.slice(0, 12)}, atual ${r.current?.slice(0, 12)}${r.behind !== undefined ? ` (${r.behind} commit(s) depois)` : ""}` : "";
        console.log(`${r.repo}: ${r.state}${extra}`);
        for (const n of r.notes) console.log(`  ${n}`);
      }
      const stale = rows.filter((r) => r.state === "desatualizada" || r.state === "sem docs");
      if (stale.length > 0) console.log(`\nAtualize com: hubspec hub document ${stale.map((r) => r.repo).join(" ")}`);
      return stale.length > 0 ? 1 : 0;
    }
    case "pr": {
      const results = openPrs(requireHub(cwd), need(pos[0], "o nome da change"), { dryRun: opt["dry-run"] === true });
      results.forEach((r) => console.log(`${r.repo}: ${r.state}${r.url ? ` ${r.url}` : ""}${r.detail ? ` — ${r.detail}` : ""}`));
      const order = results.filter((r) => r.url || r.state === "planejada").map((r) => r.repo);
      if (order.length > 1) console.log(`\nOrdem de merge: ${order.join(" → ")}`);
      return 0;
    }
    case "archive": {
      const { repo, dependents } = archiveRepo(requireHub(cwd), need(pos[0], "o nome do repo"));
      warnDependents(repo.name, dependents);
      console.log(`${repo.name}: arquivado (o sync deixa de cloná-lo; docs em docs/archive/${repo.name})`);
      return 0;
    }
    case "remove": {
      const hub = requireHub(cwd);
      const name = need(pos[0], "o nome do repo");
      if (opt["yes"] !== true) {
        if (!process.stdin.isTTY) throw new Error("remove apaga as docs e o clone: confirme com --yes");
        const answer = await ask(`Remover ${name} do repos.yaml e apagar as docs e o clone? [s/N] `);
        if (!/^s(im)?$/i.test(answer)) {
          console.log("cancelado");
          return 1;
        }
      }
      const r = removeRepo(hub, name, { force: opt["force"] === true });
      if (!r.removed) {
        console.log(`${name}: não está no repos.yaml; nada a remover`);
        return 0;
      }
      warnDependents(name, r.dependents);
      console.log(`${name}: removido do manifesto e das docs${r.clone ? `; clone ${r.clone} apagado` : ""}`);
      return 0;
    }
    default:
      throw new Error(`comando do hub desconhecido: ${command}; veja \`hubspec hub help\``);
  }
}
