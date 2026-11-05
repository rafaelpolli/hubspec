import { z } from "zod";
import type { SpecScenario, TestEvidence, TraceKind } from "./types.ts";

/** Where the agent writes its answer, inside the change folder. */
export const TRACE_FILE = ".hubspec/trace.json";

const TraceItem = z.object({
  id: z.string(),
  kind: z.enum(["teste", "manual", "sem-teste"]),
  repo: z.string().optional(),
  file: z.string().optional(),
  line: z.number().int().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
});
const TraceFile = z.object({ items: z.array(TraceItem) });

export interface TraceEntry {
  trace: TraceKind;
  /** Present for "teste" when the agent gave every field. */
  evidence?: TestEvidence;
  note?: string;
}

/** Thrown when trace.json is not the JSON asked for. */
export class TraceError extends Error {
  override readonly name = "TraceError";
}

/**
 * The agent's answer by scenario id: unknown ids are dropped, the first answer of an id
 * wins, and a scenario without an answer is "sem-teste".
 */
export function parseTrace(raw: string, scenarios: readonly SpecScenario[]): Map<string, TraceEntry> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new TraceError(`${TRACE_FILE} não é JSON`);
  }
  const checked = TraceFile.safeParse(json);
  if (!checked.success) throw new TraceError(`${TRACE_FILE} não segue o formato { "items": [ { "id", "kind", "repo", "file", "line", "name", "note" } ] }`);
  const known = new Set(scenarios.map((s) => s.id));
  const out = new Map<string, TraceEntry>();
  for (const item of checked.data.items) {
    if (!known.has(item.id) || out.has(item.id)) continue;
    const note = item.note?.trim() ? { note: item.note.trim() } : {};
    const { repo, file, line, name } = item;
    const evidence = item.kind === "teste" && file && line !== undefined && name ? { evidence: { ...(repo ? { repo } : {}), file, line, name } } : {};
    out.set(item.id, { trace: item.kind, ...evidence, ...note });
  }
  for (const s of scenarios) if (!out.has(s.id)) out.set(s.id, { trace: "sem-teste" });
  return out;
}

/** A trace.json to fill in, one item per scenario, for `hubspec scenarios --template`; `repo` in a hub. */
export function traceTemplate(scenarios: readonly SpecScenario[], hub = false): string {
  const items = scenarios.map((s) => ({ id: s.id, kind: "teste", ...(hub ? { repo: "" } : {}), file: "", line: 0, name: "", note: "" }));
  return `${JSON.stringify({ items }, null, 2)}\n`;
}
