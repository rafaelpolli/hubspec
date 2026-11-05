import { verdictOf, type ItemResult, type ProofResult, type SpecScenario, type VerificationItem, type VerificationRecord } from "./types.ts";

const RESULT: Record<ItemResult, string> = {
  coberto: "coberto",
  falhou: "falhou",
  "evidencia-invalida": "evidência inválida",
  "nao-executado": "não executado",
  "sem-teste": "sem teste",
  manual: "manual",
};
const PROOF: Record<ProofResult, string> = { forte: "forte", fraca: "fraca", inconclusiva: "inconclusiva" };

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n+/g, " ");

function evidence(item: VerificationItem): string {
  const e = item.evidence;
  if (!e) return item.reason ? cell(item.reason) : "-";
  const where = `\`${e.repo ? `${e.repo}/` : ""}${e.file}:${e.line}\` "${cell(e.name)}"`;
  return item.reason ? `${where}: ${cell(item.reason)}` : where;
}

function result(item: VerificationItem): string {
  if (item.result === "manual" && item.checked) return "manual (conferido)";
  return RESULT[item.result];
}

function proof(item: VerificationItem): string {
  if (!item.proof) return "-";
  if (item.proof.result) return PROOF[item.proof.result];
  return `falhou: ${cell(item.proof.error ?? "")}`;
}

/** The notes the user left on an item: the check of a manual item and the justification. */
function notes(item: VerificationItem, label: string): string[] {
  const out: string[] = [];
  if (item.checked) out.push(`- **${label}**: conferido${item.checked.note ? ` — ${item.checked.note}` : ""}`);
  if (item.justification) out.push(`- **${label}**: justificativa — ${item.justification}`);
  return out;
}

/**
 * `verification.md`: rewritten from `.hubspec/verification.json` after every change, never
 * read back. Scenarios are grouped by capability and requirement, in the order of the delta
 * specs; `#n` is the item's number for `hubspec check` and `hubspec justify`.
 */
export function renderReport(v: VerificationRecord): string {
  const lines = [
    `# Verificação: ${v.change}`,
    "",
    `- Veredito: **${verdictOf(v.items)}**`,
    `- Data: ${v.createdAt}`,
    `- Estado verificado: ${Object.entries(v.fingerprint)
      .map(([k, h]) => `${k.replace(/^repo:/, "")} \`${h.slice(0, 12)}\``)
      .join(", ")}`,
    "",
    "<!-- Gerado pelo hubspec a partir de .hubspec/verification.json; não edite à mão. -->",
    "",
  ];
  const number = new Map(v.items.map((item, i) => [item, i + 1]));
  const scenarios = v.items.filter((i): i is VerificationItem & { scenario: SpecScenario } => i.kind === "cenario" && !!i.scenario);
  if (scenarios.length === 0) lines.push("A change não tem cenários a verificar.", "");
  for (const cap of [...new Set(scenarios.map((i) => i.scenario.capability))]) {
    lines.push(`## ${cap}`, "");
    const ofCap = scenarios.filter((i) => i.scenario.capability === cap);
    for (const req of [...new Set(ofCap.map((i) => i.scenario.requirement))]) {
      const ofReq = ofCap.filter((i) => i.scenario.requirement === req);
      lines.push(`### ${req}`, "", "| # | Cenário | Evidência | Resultado | Prova |", "|---|---|---|---|---|");
      for (const i of ofReq) lines.push(`| ${number.get(i)} | ${cell(i.scenario.name)} | ${evidence(i)} | ${result(i)} | ${proof(i)} |`);
      const extra = ofReq.flatMap((i) => notes(i, i.scenario.name));
      lines.push("", ...(extra.length > 0 ? [...extra, ""] : []));
    }
  }
  const pending = v.items.find((i) => i.kind === "tasks-pendentes");
  if (pending) {
    lines.push(`## Tasks pendentes (#${number.get(pending)})`, "", `- ${(pending.pendingTasks ?? []).join(", ")}`, ...notes(pending, "Tasks pendentes"), "");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}
