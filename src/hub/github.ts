import { z } from "zod";
import { run } from "../proc.ts";

/** The gh CLI, already authenticated on the machine. */
function gh(args: string[], cwd?: string) {
  const res = run(["gh", ...args], { ...(cwd ? { cwd } : {}), env: { GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } });
  if (res.code === 127) throw new Error("o gh CLI não foi encontrado: instale-o e rode `gh auth login`");
  return res;
}

function ghMust(args: string[], cwd?: string): string {
  const res = gh(args, cwd);
  if (!res.ok) throw new Error(`gh ${args.slice(0, 2).join(" ")} falhou: ${(res.err || res.out).trim()}`);
  return res.out;
}

/** `owner/repo`, the short form of a GitHub repo. */
const SHORT = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;

export function isShortRepo(spec: string): boolean {
  return SHORT.test(spec);
}

/** How the machine talks to GitHub: gh's `git_protocol` (ssh or https); https without gh. */
export function gitProtocol(): "ssh" | "https" {
  try {
    const res = gh(["config", "get", "git_protocol", "-h", "github.com"]);
    return res.ok && res.out.trim() === "ssh" ? "ssh" : "https";
  } catch {
    return "https";
  }
}

/**
 * A repo as the user wrote it: a URL is kept as is; `owner/repo` becomes a GitHub URL in the
 * protocol the machine is set up for, so a machine with only SSH clones over SSH.
 */
export function repoUrl(spec: string, protocol: () => "ssh" | "https" = gitProtocol): string {
  const short = SHORT.exec(spec);
  if (!short) return spec;
  return protocol() === "ssh" ? `git@github.com:${short[1]}/${short[2]}.git` : `https://github.com/${short[1]}/${short[2]}.git`;
}

/** The open PR of a branch, if there is one. */
export function prOf(cwd: string, branch: string): { url: string; number: number } | undefined {
  const res = gh(["pr", "list", "--head", branch, "--state", "open", "--json", "url,number", "--limit", "1"], cwd);
  if (!res.ok) return undefined;
  return z.array(z.object({ url: z.string(), number: z.number() })).parse(JSON.parse(res.out || "[]"))[0];
}

export function createPr(cwd: string, input: { base: string; head: string; title: string; body: string }): string {
  const out = ghMust(["pr", "create", "--base", input.base, "--head", input.head, "--title", input.title, "--body", input.body], cwd);
  const url = out.trim().split("\n").pop()?.trim();
  if (!url || !/^https?:\/\//.test(url)) throw new Error(`gh pr create não devolveu o link da PR: ${out.trim()}`);
  return url;
}

export function editPrBody(cwd: string, url: string, body: string): void {
  ghMust(["pr", "edit", url, "--body", body], cwd);
}
