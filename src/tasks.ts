const CHECKBOX = /^\s*[-*]\s+\[([^\]]*)\]\s+(.*)$/;
const TASK_ID = /^(\d+(?:\.\d+)*)\s+/;

/**
 * The tasks of a tasks.md checklist still unchecked, the way OpenSpec apply tracks them: a
 * box holding only `x` (any case, any spacing) is done; every other marker is unfinished.
 * A task is named by its id, or by its line when it has none.
 */
export function pendingTasks(markdown: string): string[] {
  const out: string[] = [];
  markdown.split(/\r?\n/).forEach((raw, index) => {
    const box = CHECKBOX.exec(raw);
    if (!box || box[1]!.trim().toLowerCase() === "x") return;
    out.push(TASK_ID.exec(box[2]!.trim())?.[1] ?? `linha ${index + 1}`);
  });
  return out;
}
