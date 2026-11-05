// The verification of an implemented change, as in OpenSpec Studio (add-change-verification).
// Outside a hub the project is the only member; in a hub, each cloned repo is one.

/** A `#### Scenario:` of an ADDED or MODIFIED requirement in one of the change's delta specs. */
export interface SpecScenario {
  /** `<capability>/<requirement>/<scenario>`. */
  id: string;
  /** Spec path under `specs/`, such as `git-repositories` or `identity/user-auth`. */
  capability: string;
  requirement: string;
  name: string;
  /** The scenario's WHEN/THEN lines. */
  text: string;
}

/** How the agent classified a scenario in trace.json. */
export type TraceKind = "teste" | "manual" | "sem-teste";

/** The test the agent pointed to for a scenario. */
export interface TestEvidence {
  /** The hub's repo the test is in; absent outside a hub. */
  repo?: string;
  /** Path relative to the repo (in a hub) or to the project. */
  file: string;
  line: number;
  name: string;
}

/**
 * Where an item stands:
 * - `coberto`: the test passed; `falhou`: it failed;
 * - `evidencia-invalida`: the evidence did not check out, so nothing ran;
 * - `nao-executado`: the project's test runner is unknown;
 * - `sem-teste`, `manual`: as the agent classified it.
 */
export type ItemResult = "coberto" | "falhou" | "evidencia-invalida" | "nao-executado" | "sem-teste" | "manual";

/** Red → green proof: "forte" fails before the change and passes now. */
export type ProofResult = "forte" | "fraca" | "inconclusiva";

export interface ItemProof {
  status: "concluida" | "falhou";
  result?: ProofResult;
  error?: string;
}

export interface VerificationItem {
  /** The scenario id, or `tasks-pendentes`. */
  id: string;
  kind: "cenario" | "tasks-pendentes";
  scenario?: SpecScenario;
  /** Ids of the tasks still unchecked in tasks.md, for the `tasks-pendentes` item. */
  pendingTasks?: string[];
  trace?: TraceKind;
  evidence?: TestEvidence;
  /** The agent's note on the item. */
  note?: string;
  result: ItemResult;
  /** Why the evidence is invalid or the test did not run. */
  reason?: string;
  /** The argv run (or that would be run) for the test. */
  command?: string[];
  /** The tail of the test's output. */
  output?: string;
  proof?: ItemProof;
  /** Set when the user confirmed a manual item. */
  checked?: { note?: string };
  justification?: string;
}

export type Verdict = "PASS" | "CONCERNS" | "FAIL";

/** `.hubspec/verification.json`: the last verification of a change. */
export interface VerificationRecord {
  change: string;
  createdAt: string;
  /** What was verified: the project's code and the change's artifacts. */
  fingerprint: Record<string, string>;
  items: VerificationItem[];
}

/** Whether an item keeps the verdict from PASS, before any justification. */
export function isConcern(item: VerificationItem): boolean {
  if (item.kind === "tasks-pendentes") return true;
  if (item.result === "manual") return !item.checked;
  if (item.result === "coberto") return item.proof?.result === "fraca";
  return item.result !== "falhou";
}

/** The verdict of a set of items. */
export function verdictOf(items: readonly VerificationItem[]): Verdict {
  if (items.some((i) => i.result === "falhou")) return "FAIL";
  return items.some(isConcern) ? "CONCERNS" : "PASS";
}
