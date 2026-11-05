import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { exec, type ExecResult } from "./exec.ts";
import { changed, fingerprint, REPORT_FILE, WORK_DIR } from "./fingerprint.ts";
import { checkEvidence } from "./evidence.ts";
import { prove } from "./proof.ts";
import { renderReport } from "./report.ts";
import { testCommand } from "./runners.ts";
import { changeScenarios } from "./scenarios.ts";
import { changedPaths, isGit, snapshot, treeOf } from "./snapshot.ts";
import { pendingTasks } from "./tasks.ts";
import { parseTrace, TRACE_FILE, type TraceEntry } from "./trace.ts";
import { isConcern, verdictOf, type SpecScenario, type TestEvidence, type VerificationItem, type VerificationRecord } from "./types.ts";
import { isClone } from "./hub/git.ts";
import { loadManifest, MANIFEST, repoPath } from "./hub/manifest.ts";

export const STATE_FILE = `${WORK_DIR}/verification.json`;
const PENDING_ID = "tasks-pendentes";
const TEST_TIMEOUT_MS = 5 * 60_000;

/** A request the change's current state does not allow; the message is for the user. */
export class FlowError extends Error {
  override readonly name = "FlowError";
}

/** The project: the nearest folder, from `cwd` up, that has an `openspec/` folder. */
export function findProject(cwd: string): string {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "openspec")) && statSync(join(dir, "openspec")).isDirectory()) return dir;
    if (dirname(dir) === dir) throw new FlowError("nenhuma pasta openspec/ encontrada a partir daqui: rode `hubspec init` na raiz do projeto");
  }
}

export function changeDir(project: string, change: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(change)) throw new FlowError(`nome de change inválido: ${change}`);
  const dir = join(project, "openspec", "changes", change);
  if (!existsSync(dir)) throw new FlowError(`a change ${change} não existe em openspec/changes`);
  return dir;
}

export function loadRecord(dir: string): VerificationRecord | undefined {
  const file = join(dir, STATE_FILE);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as VerificationRecord;
}

/** Where a change's code lives: the project, or in a hub its cloned active repos. */
export interface Members {
  hub: boolean;
  repos: { name: string; path: string }[];
}

export function members(project: string): Members {
  if (!existsSync(join(project, MANIFEST))) return { hub: false, repos: [] };
  const repos = loadManifest(project)
    .repos.filter((r) => r.status === "active")
    .map((r) => ({ name: r.name, path: repoPath(project, r) }))
    .filter((r) => isClone(r.path));
  return { hub: true, repos };
}

/** The folder a test runs in: its repo in a hub, else the project; or why there is none. */
function memberOf(project: string, m: Members, evidence: TestEvidence): { path: string } | { reason: string } {
  if (!m.hub) return { path: project };
  const names = m.repos.map((r) => r.name).join(", ") || "nenhum";
  if (!evidence.repo) return { reason: `informe o repo do teste (um destes: ${names})` };
  const repo = m.repos.find((r) => r.name === evidence.repo);
  return repo ? { path: repo.path } : { reason: `o repo ${evidence.repo} não está clonado no hub (clonados: ${names})` };
}

function saveRecord(dir: string, record: VerificationRecord): void {
  mkdirSync(join(dir, WORK_DIR), { recursive: true });
  writeFileSync(join(dir, STATE_FILE), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(join(dir, REPORT_FILE), renderReport(record));
}

/** A scenario's item from the agent's answer, its evidence checked and its command built. */
function item(project: string, m: Members, scenario: SpecScenario, entry: TraceEntry): VerificationItem {
  const base: VerificationItem = { id: scenario.id, kind: "cenario", scenario, trace: entry.trace, result: "sem-teste", ...(entry.note ? { note: entry.note } : {}) };
  if (entry.trace === "manual") return { ...base, result: "manual" };
  if (entry.trace === "sem-teste") return base;
  const invalid = (reason: string) => ({ ...base, ...(entry.evidence ? { evidence: entry.evidence } : {}), result: "evidencia-invalida" as const, reason });
  const member = entry.evidence ? memberOf(project, m, entry.evidence) : { path: project };
  if ("reason" in member) return invalid(member.reason);
  const check = checkEvidence(member.path, entry.evidence);
  if (!check.ok) return invalid(check.reason);
  const cmd = testCommand(member.path, check.evidence.file, check.evidence.name);
  if (!cmd.argv) return { ...base, evidence: check.evidence, result: "nao-executado", ...(cmd.reason ? { reason: cmd.reason } : {}) };
  return { ...base, evidence: check.evidence, result: "falhou", command: cmd.argv };
}

export interface VerifyOptions {
  /** Also run the red → green proof against the code at this commit-ish. */
  proveBase?: string;
  timeoutMs?: number;
  /** Called as each test starts, for progress output. */
  onTest?: (item: VerificationItem) => void;
}

/**
 * Verifies a change: the scenarios of its delta specs, the agent's trace.json checked
 * against the code, each test run once, the unchecked tasks, and optionally the proof.
 * Writes `.hubspec/verification.json` and `verification.md`, replacing the previous ones.
 */
export async function verify(project: string, change: string, opts: VerifyOptions = {}): Promise<VerificationRecord> {
  const dir = changeDir(project, change);
  const m = members(project);
  const scenarios = changeScenarios(dir);
  const items: VerificationItem[] = [];
  if (scenarios.length > 0) {
    const file = join(dir, TRACE_FILE);
    if (!existsSync(file)) {
      throw new FlowError(`falta ${TRACE_FILE} na change: rode \`hubspec scenarios ${change} --template\` e preencha um item por cenário`);
    }
    const trace = parseTrace(readFileSync(file, "utf8"), scenarios);
    for (const s of scenarios) items.push(item(project, m, s, trace.get(s.id)!));
  }
  const tasks = join(dir, "tasks.md");
  const pending = existsSync(tasks) ? pendingTasks(readFileSync(tasks, "utf8")) : [];
  if (pending.length > 0) items.push({ id: PENDING_ID, kind: "tasks-pendentes", pendingTasks: pending, result: "sem-teste" });

  // The tree from before the change, per folder the tests run in; or why the proof cannot run there.
  const before = new Map<string, string | Error>();
  const beforeOf = (path: string, base: string): string | Error => {
    if (!before.has(path)) {
      try {
        if (!isGit(path)) throw new FlowError("a prova vermelho → verde precisa de um repositório Git");
        const tree = treeOf(path, base);
        const code = changedPaths(path, tree, snapshot(path)).filter((p) => m.hub || (p !== "openspec" && !p.startsWith("openspec/")));
        if (code.length === 0) throw new FlowError(`o código não mudou desde ${base}: use --prove <commit de antes da change>`);
        before.set(path, tree);
      } catch (err) {
        before.set(path, err as Error);
      }
    }
    return before.get(path)!;
  };
  if (opts.proveBase !== undefined && !m.hub) {
    // One project: a proof that cannot run is an error of the whole command.
    const tree = beforeOf(project, opts.proveBase);
    if (tree instanceof Error) throw tree;
  }

  const timeoutMs = opts.timeoutMs ?? TEST_TIMEOUT_MS;
  const done = new Map<string, ExecResult>();
  for (const i of items) {
    if (!i.command || !i.evidence) continue;
    const cwd = (memberOf(project, m, i.evidence) as { path: string }).path;
    const key = JSON.stringify([cwd, i.command]);
    let res = done.get(key);
    if (!res) {
      opts.onTest?.(i);
      res = await exec(i.command, { cwd, timeoutMs });
      done.set(key, res);
    }
    i.result = res.exitCode === 0 && !res.timedOut ? "coberto" : "falhou";
    i.output = res.output;
    if (res.timedOut) i.reason = "o teste passou do tempo limite";
    if (opts.proveBase !== undefined && i.result === "coberto") {
      const tree = beforeOf(cwd, opts.proveBase);
      i.proof = tree instanceof Error ? { status: "falhou", error: tree.message } : await prove({ project: cwd, before: tree, argv: i.command, timeoutMs });
    }
  }

  const record: VerificationRecord = { change, createdAt: new Date().toISOString(), fingerprint: fingerprint(project, dir, m.hub ? m.repos : undefined), items };
  saveRecord(dir, record);
  return record;
}

/** The item a user refers to: its number in verification.md, or its id. */
function find(record: VerificationRecord, ref: string): VerificationItem {
  const n = /^#?(\d+)$/.exec(ref.trim());
  const found = n ? record.items[Number(n[1]) - 1] : record.items.find((i) => i.id === ref.trim());
  if (!found) throw new FlowError(`item ${ref} não existe na verificação (veja os números em ${REPORT_FILE})`);
  return found;
}

function update(project: string, change: string, ref: string, fn: (item: VerificationItem) => void): VerificationRecord {
  const dir = changeDir(project, change);
  const record = loadRecord(dir);
  if (!record) throw new FlowError(`a change ${change} ainda não foi verificada: rode \`hubspec verify ${change}\``);
  fn(find(record, ref));
  saveRecord(dir, record);
  return record;
}

/** Marks a manual item as checked by the user. */
export function check(project: string, change: string, ref: string, note?: string): VerificationRecord {
  return update(project, change, ref, (i) => {
    if (i.result !== "manual") throw new FlowError("só um item de verificação manual pode ser marcado como conferido");
    i.checked = note?.trim() ? { note: note.trim() } : {};
  });
}

/** Justifies an item that keeps the verdict at CONCERNS; an empty text removes the justification. */
export function justify(project: string, change: string, ref: string, text: string): VerificationRecord {
  return update(project, change, ref, (i) => {
    if (!isConcern(i)) throw new FlowError("só um item que deixa o veredito em CONCERNS precisa de justificativa");
    if (text.trim()) i.justification = text.trim();
    else delete i.justification;
  });
}

export interface Gate {
  allowed: boolean;
  reason?: string;
  verdict?: ReturnType<typeof verdictOf>;
  /** Numbers of the items that cause CONCERNS and still need a justification. */
  missing: number[];
}

/** Whether the change may be archived: verified, not stale, no failing test, every concern justified. */
export function gate(project: string, change: string): Gate {
  const dir = changeDir(project, change);
  const record = loadRecord(dir);
  if (!record) return { allowed: false, reason: `verifique a change antes de arquivar: \`hubspec verify ${change}\``, missing: [] };
  const verdict = verdictOf(record.items);
  const missing = record.items.flatMap((i, n) => (isConcern(i) && !i.justification ? [n + 1] : []));
  const m = members(project);
  const reason = changed(record.fingerprint, fingerprint(project, dir, m.hub ? m.repos : undefined))
    ? "o código ou os artefatos mudaram depois da verificação: verifique de novo"
    : verdict === "FAIL"
      ? "há testes falhando: corrija e verifique de novo"
      : missing.length > 0
        ? `justifique os itens que deixam o veredito em CONCERNS (${missing.map((n) => `#${n}`).join(", ")}) com \`hubspec justify ${change} <n> "<motivo>"\``
        : undefined;
  return { allowed: !reason, ...(reason ? { reason } : {}), verdict, missing };
}
