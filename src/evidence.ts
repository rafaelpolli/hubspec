import { existsSync, readFileSync, statSync } from "node:fs";
import { resolveInside } from "./paths.ts";
import type { TestEvidence } from "./types.ts";

/** Lines after the given one where the test's name may still be. */
const WINDOW = 5;

export type EvidenceCheck = { ok: true; path: string; evidence: TestEvidence } | { ok: false; reason: string };

/**
 * Forms of the name the agent may have written: as is, with escaped quotes undone, and
 * without leading `describe` names (joined by " > " or " › ", as runners print them).
 */
function candidates(name: string): string[] {
  const plain = name.replace(/\\(["'`])/g, "$1");
  const out = [name, plain];
  for (const sep of [" > ", " › "]) {
    let i = plain.indexOf(sep);
    while (i >= 0) {
      out.push(plain.slice(i + sep.length));
      i = plain.indexOf(sep, i + 1);
    }
  }
  return [...new Set(out.map((c) => c.trim()))].filter((c) => c.length >= 3);
}

/**
 * Checks a test the agent pointed to, without the agent: the file is inside the project and
 * exists, and the name is on the given line or up to 5 lines after it. On success the
 * evidence carries the form of the name found in the file.
 */
export function checkEvidence(project: string, evidence: TestEvidence | undefined): EvidenceCheck {
  if (!evidence) return { ok: false, reason: "o agente não informou arquivo, linha e nome do teste" };
  let path: string;
  try {
    path = resolveInside([project], evidence.file);
  } catch {
    return { ok: false, reason: `${evidence.file} está fora do projeto` };
  }
  if (!existsSync(path) || !statSync(path).isFile()) return { ok: false, reason: `${evidence.file} não existe no projeto` };
  const lines = readFileSync(path, "utf8").split("\n");
  if (evidence.line < 1 || evidence.line > lines.length) {
    return { ok: false, reason: `${evidence.file} tem ${lines.length} linhas, e a evidência aponta a linha ${evidence.line}` };
  }
  const window = lines.slice(evidence.line - 1, evidence.line - 1 + WINDOW + 1).join("\n");
  const found = candidates(evidence.name).find((c) => window.includes(c));
  if (!found) return { ok: false, reason: `o nome do teste não aparece perto da linha ${evidence.line}` };
  return { ok: true, path, evidence: { ...evidence, name: found } };
}
