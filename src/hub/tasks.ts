const CHECKBOX = /^(\s*[-*]\s+\[)([^\]]*)(\]\s+)(.*)$/;
const HEADING = /^##\s+(?:\d+\.\s*)?(.*?)\s*$/;
/** `worker (depende de: api, lib)`: a section's repo and the repos it depends on in this change. */
const DEPENDS = /^(.*?)\s*\((?:depende de|depends on):\s*([^)]*)\)$/i;
const TASK_ID = /^(\d+(?:\.\d+)*)\s+/;
const TAG = /^\[([A-Za-z0-9._-]+)\]\s*/;
const PR = /\s+→\s+PR:\s+\S+\s*$/;

/** The repo tag of a task that is done by hand, outside any repo (creating a repo, for one). */
export const MANUAL = "manual";

/**
 * A task of a hub change: `- [ ] 2.1 [api] Contrato do evento — \`src/events/\``. The repo is
 * the `[tag]` at the start of the text, or else the section's title when it names a repo.
 */
export interface HubTask {
  /** 0-based line in tasks.md. */
  index: number;
  id: string | null;
  done: boolean;
  repo: string | undefined;
  text: string;
  pr?: string;
}

export function parseHubTasks(markdown: string, repos: readonly string[]): HubTask[] {
  const out: HubTask[] = [];
  let section: string | undefined;
  markdown.split("\n").forEach((line, index) => {
    const heading = HEADING.exec(line);
    if (heading) {
      const title = sectionTitle(heading[1]!).repo;
      section = title.toLowerCase() === MANUAL ? MANUAL : repos.includes(title) ? title : undefined;
      return;
    }
    const box = CHECKBOX.exec(line);
    if (!box) return;
    let body = box[4]!.trim();
    const pr = /→\s+PR:\s+(\S+)\s*$/.exec(body)?.[1];
    body = body.replace(PR, "");
    const id = TASK_ID.exec(body);
    if (id) body = body.slice(id[0].length);
    const tag = TAG.exec(body);
    const repo = tag ? tag[1]! : section;
    if (tag) body = body.slice(tag[0].length);
    out.push({ index, id: id ? id[1]! : null, done: box[2]!.trim().toLowerCase() === "x", repo, text: body.trim(), ...(pr ? { pr } : {}) });
  });
  return out;
}

function sectionTitle(title: string): { repo: string; dependsOn: string[] } {
  const deps = DEPENDS.exec(title);
  if (!deps) return { repo: title, dependsOn: [] };
  return { repo: deps[1]!.trim(), dependsOn: deps[2]!.split(",").map((d) => d.trim().replace(/^\[|\]$/g, "")).filter(Boolean) };
}

/**
 * The dependencies between repos a change declares (spec 10), in its section titles:
 * `## 3. worker (depende de: api)`. Keyed by repo; a repo may have several sections.
 */
export function declaredDependencies(markdown: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of markdown.split("\n")) {
    const heading = HEADING.exec(line);
    if (!heading) continue;
    const { repo, dependsOn } = sectionTitle(heading[1]!);
    if (dependsOn.length > 0) out.set(repo, [...new Set([...(out.get(repo) ?? []), ...dependsOn])]);
  }
  return out;
}

/** The repos a change's tasks touch, in the order they first appear (the execution order). */
export function taskRepos(tasks: readonly HubTask[]): string[] {
  return [...new Set(tasks.map((t) => t.repo).filter((r): r is string => !!r && r !== MANUAL))];
}

function setLine(markdown: string, index: number, fn: (line: string) => string): string {
  const lines = markdown.split("\n");
  lines[index] = fn(lines[index]!);
  return lines.join("\n");
}

/** Checks the first unchecked `[manual]` task. Returns the new text and the task, if any. */
export function completeManual(markdown: string, repos: readonly string[]): { markdown: string; task?: HubTask } {
  const task = parseHubTasks(markdown, repos).find((t) => t.repo === MANUAL && !t.done);
  if (!task) return { markdown };
  return { markdown: setLine(markdown, task.index, (l) => l.replace(CHECKBOX, "$1x$3$4")), task };
}

/** Writes (or replaces) the PR link at the end of each of the repo's tasks. */
export function linkPr(markdown: string, repos: readonly string[], repo: string, url: string): string {
  let out = markdown;
  for (const t of parseHubTasks(markdown, repos).filter((t) => t.repo === repo)) {
    out = setLine(out, t.index, (l) => `${l.replace(PR, "")} → PR: ${url}`);
  }
  return out;
}
