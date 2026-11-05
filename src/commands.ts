import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Command } from "commander";
import { REPORT_FILE } from "./fingerprint.ts";
import { changeScenarios } from "./scenarios.ts";
import { TRACE_FILE, traceTemplate } from "./trace.ts";
import { verdictOf, type VerificationItem, type VerificationRecord } from "./types.ts";
import { changeDir, check, findProject, FlowError, gate, justify, verify } from "./verify.ts";
import { HUB_HELP, hubCommand } from "./hub/cli.ts";
import { findHub } from "./hub/manifest.ts";

/** Options that take every value up to the next option: `--repos <url1> <url2>`. */
const MULTI = new Set(["repos", "done"]);
/** Options that never take a value, so a positional argument can follow them. */
const FLAGS = new Set(["json", "template", "global", "new", "dry-run", "yes", "force", "help"]);

/** `--name value` / `--flag` options, and the positional arguments left (the hub's commands). */
function parse(args: string[]): { pos: string[]; opt: Record<string, string | string[] | true> } {
  const pos: string[] = [];
  const opt: Record<string, string | string[] | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const name = a.slice(2);
    if (FLAGS.has(name)) {
      opt[name] = true;
      continue;
    }
    if (MULTI.has(name)) {
      const values: string[] = [];
      while (args[i + 1] !== undefined && !args[i + 1]!.startsWith("--")) values.push(args[++i]!);
      opt[name] = values.length > 0 ? values : true;
      continue;
    }
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      opt[name] = next;
      i++;
    } else opt[name] = true;
  }
  return { pos, opt };
}

const LABEL: Record<VerificationItem["result"], string> = {
  coberto: "coberto",
  falhou: "FALHOU",
  "evidencia-invalida": "evidência inválida",
  "nao-executado": "não executado",
  "sem-teste": "sem teste",
  manual: "manual",
};

function summary(record: VerificationRecord): string {
  const lines = [`Veredito: ${verdictOf(record.items)}`];
  record.items.forEach((i, n) => {
    const name = i.kind === "tasks-pendentes" ? `tasks pendentes: ${(i.pendingTasks ?? []).join(", ")}` : i.scenario!.name;
    const label = i.result === "manual" && i.checked ? "manual (conferido)" : LABEL[i.result];
    const proof = i.proof?.result ? `, prova ${i.proof.result}` : i.proof?.error ? `, prova falhou: ${i.proof.error}` : "";
    const why = i.reason ? ` — ${i.reason}` : "";
    const just = i.justification ? ` [justificado]` : "";
    lines.push(`  #${n + 1} ${label}${proof}: ${name}${why}${just}`);
  });
  return lines.join("\n");
}

/** Runs a command's body, turning its errors into `hubspec: <message>` and exit code 1. */
function action<A extends unknown[]>(body: (...args: A) => number | Promise<number>): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      process.exitCode = await body(...args);
    } catch (err) {
      console.error(`hubspec: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  };
}

/** hubspec's own commands, next to OpenSpec's: verification, the archive gate and the hub. */
export function registerHubspecCommands(program: Command): void {
  program
    .command("scenarios <change>")
    .description("Os cenários das delta specs da change; --template cria o trace para preencher")
    .option("--json", "Saída em JSON")
    .option("--template", `Cria ${TRACE_FILE} com um item por cenário`)
    .action(
      action((change: string, opts: { json?: boolean; template?: boolean }) => {
        const dir = changeDir(findProject(process.cwd()), change);
        const scenarios = changeScenarios(dir);
        if (opts.template) {
          const file = join(dir, TRACE_FILE);
          if (existsSync(file)) throw new FlowError(`${file} já existe; edite-o`);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, traceTemplate(scenarios, findHub(dir) !== undefined));
          console.log(file);
        } else if (opts.json) console.log(JSON.stringify(scenarios, null, 2));
        else for (const s of scenarios) console.log(`- ${s.id}\n${s.text.replace(/^/gm, "    ")}`);
        return 0;
      }),
    );

  program
    .command("verify <change>")
    .description(`Confere ${TRACE_FILE}, roda os testes e escreve ${REPORT_FILE} (saída 0 = PASS, 2 = CONCERNS, 1 = FAIL)`)
    .option("--prove [commit]", "Prova que cada teste falhava antes da change (padrão: HEAD)")
    .option("--timeout <segundos>", "Tempo máximo de cada teste")
    .option("--json", "Saída em JSON")
    .action(
      action(async (change: string, opts: { prove?: string | boolean; timeout?: string; json?: boolean }) => {
        const project = findProject(process.cwd());
        const record = await verify(project, change, {
          ...(opts.prove ? { proveBase: typeof opts.prove === "string" ? opts.prove : "HEAD" } : {}),
          ...(opts.timeout ? { timeoutMs: Number(opts.timeout) * 1000 } : {}),
          ...(opts.json ? {} : { onTest: (i: VerificationItem) => console.error(`rodando: ${i.command!.join(" ")}`) }),
        });
        console.log(opts.json ? JSON.stringify(record, null, 2) : `${summary(record)}\n\nRelatório: ${join(changeDir(project, change), REPORT_FILE)}`);
        const verdict = verdictOf(record.items);
        return verdict === "PASS" ? 0 : verdict === "FAIL" ? 1 : 2;
      }),
    );

  program
    .command("check <change> <n>")
    .description("Confirma um item manual da verificação")
    .option("--note <texto>", "Como foi conferido")
    .action(
      action((change: string, n: string, opts: { note?: string }) => {
        console.log(summary(check(findProject(process.cwd()), change, n, opts.note)));
        return 0;
      }),
    );

  program
    .command("justify <change> <n> <texto...>")
    .description("Justifica um item que deixa a verificação em CONCERNS")
    .action(
      action((change: string, n: string, text: string[]) => {
        console.log(summary(justify(findProject(process.cwd()), change, n, text.join(" "))));
        return 0;
      }),
    );

  program
    .command("gate <change>")
    .description("O portão do archive: liberado com PASS, ou CONCERNS justificado, de uma verificação em dia (saída 0 = liberado)")
    .option("--json", "Saída em JSON")
    .action(
      action((change: string, opts: { json?: boolean }) => {
        const g = gate(findProject(process.cwd()), change);
        console.log(opts.json ? JSON.stringify(g, null, 2) : g.allowed ? `Portão liberado (${g.verdict}).` : `Portão fechado: ${g.reason}`);
        return g.allowed ? 0 : 1;
      }),
    );

  program
    .command("hub")
    .description("Hub multi-repo: repos.yaml, docs dos repos, changes que atravessam repos (hubspec hub help)")
    .argument("[args...]")
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments()
    .addHelpText("after", `\n${HUB_HELP}`)
    .action(
      action((args: string[]) => {
        const { pos, opt } = parse(args);
        return hubCommand(opt["help"] ? "help" : pos[0], pos.slice(1), opt, process.cwd());
      }),
    );
}
