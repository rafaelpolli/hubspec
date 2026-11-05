import { isShortRepo } from "./github.ts";

/** A repo found in a text document, with what the rest of its line said about it. */
export interface ListedRepo {
  /** A URL, or `owner/repo` (made into a URL by `repoUrl`). */
  spec: string;
  description?: string;
}

const URL = /(?:(?:https?|ssh|git|file):\/\/[^\s<>()[\]`"']+|git@[\w.-]+:[^\s<>()[\]`"']+)/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
/** A path in prose (`docs/overview.md`), not an `owner/repo`. */
const FILE = /\.(md|txt|ya?ml|json|toml|ts|js|py|go|java|sh|html|css)$/i;

/**
 * The repos listed in a free-form text document (`hub init --repos-file`): one per line, as a
 * URL anywhere in the line (plain, `<url>` or a Markdown link) or as a line that is only
 * `owner/repo`. What else the line says (after a dash, colon or the link text) becomes the
 * description. Lines without a repo, such as headings and prose, are ignored.
 */
export function parseRepoList(text: string): ListedRepo[] {
  const out: ListedRepo[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(BULLET, "").trim();
    if (!line || (line.startsWith("#") && !URL.test(line))) continue;
    let spec: string | undefined;
    let rest = "";
    const url = URL.exec(line);
    if (url) {
      spec = url[0].replace(/[.,;:]+$/, "");
      // Markdown link `[api](url)` or `<url>`: the brackets go, the link text stays as text.
      rest = line.replace(url[0], " ").replace(/\[([^\]]*)\]\(\s*\)/g, "$1").replace(/<\s*>/g, " ");
    } else {
      const [first = "", ...words] = line.split(/\s+/);
      if (!isShortRepo(first.replace(/`/g, "")) || FILE.test(first.replace(/`/g, ""))) continue;
      spec = first.replace(/`/g, "");
      rest = words.join(" ");
    }
    if (seen.has(spec)) continue;
    seen.add(spec);
    const trim = (t: string) => t.replace(/^[\s\-–—:|·]+/, "").replace(/[\s\-–—:|·]+$/, "").replace(/\s+/g, " ").trim();
    // The repo's own name (a link text like `[api](url)`) is not a description.
    const name = spec.replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop() ?? "";
    let description = trim(rest);
    if (name && (description === name || description.startsWith(`${name} `) || description.startsWith(`${name}:`))) description = trim(description.slice(name.length));
    out.push({ spec, ...(description ? { description } : {}) });
  }
  return out;
}
