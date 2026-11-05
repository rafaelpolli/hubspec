import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { COMMANDS, renderCommand } from "../src/hub/agents.ts";

setDefaultTimeout(120_000);

const ROOT = resolve(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "hubspec-init-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The built CLI under Node, as users run it (`bun test` builds it first, in pretest).
const CLI = join(ROOT, "dist", "cli.js");
const home = join(dir, "home");
mkdirSync(home);

/** The CLI with an isolated HOME. */
function hubspec(cwd: string, ...args: string[]) {
  return runCli(CLI, cwd, ...args);
}

function runCli(cli: string, cwd: string, ...args: string[]) {
  const res = Bun.spawnSync(["node", cli, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"), NODE_PATH: "", NO_COLOR: "1" },
  });
  return { code: res.exitCode, out: res.stdout.toString(), err: res.stderr.toString() };
}

const SKILLS = ["hubspec-archive", "hubspec-decide", "hubspec-document", "hubspec-explore", "hubspec-hub", "hubspec-verify"];
const FOLDERS = [".claude", ".devin", ".github", ".opencode", ".cursor"];

test("os comandos do plugin do Claude Code estão em dia com os adaptadores (bun run gen:plugin)", () => {
  for (const cmd of Object.keys(COMMANDS)) {
    expect(readFileSync(join(ROOT, "commands", "hub", `${cmd}.md`), "utf8")).toBe(renderCommand("claude", cmd).text);
  }
});

describe("hubspec init", () => {
  const project = join(dir, "app");
  mkdirSync(project);

  test("um comando: openspec/, as skills /opsx padrão e as hubspec-* em cada ferramenta, inclusive além das 4", () => {
    const res = hubspec(project, "init", "--tools", "claude,devin,github-copilot,opencode,cursor", "--no-animation");
    expect(res.code).toBe(0);
    expect(res.out).toContain("hubspec: skills hubspec-* em .claude/skills");
    expect(existsSync(join(project, "openspec", "config.yaml"))).toBe(true);
    for (const folder of FOLDERS) {
      const skills = readdirSync(join(project, folder, "skills"));
      for (const s of SKILLS) expect(skills).toContain(s);
      expect(skills).toContain("openspec-propose");
    }
  });

  test("as skills padrão chamam o hubspec, e o archive delas passa pelo portão", () => {
    const propose = readFileSync(join(project, ".claude", "skills", "openspec-propose", "SKILL.md"), "utf8");
    expect(propose).toContain("allowed-tools: Bash(hubspec:*)");
    expect(propose).toContain("hubspec new change");
    expect(propose).not.toMatch(/\bopenspec (new|status|instructions)\b/);
    const archive = readFileSync(join(project, ".claude", "skills", "openspec-archive-change", "SKILL.md"), "utf8");
    expect(archive).toContain('run `hubspec gate "<change-name>"`');
  });

  test("update repõe as skills do hubspec", () => {
    rmSync(join(project, ".claude", "skills", "hubspec-verify"), { recursive: true });
    const res = hubspec(project, "update");
    expect(res.code).toBe(0);
    expect(readdirSync(join(project, ".claude", "skills"))).toContain("hubspec-verify");
  });

  test("os comandos do OpenSpec rodam no próprio hubspec; a config global é a do hubspec", () => {
    const res = hubspec(project, "list", "--json");
    expect(res.code).toBe(0);
    expect(JSON.parse(res.out)).toHaveProperty("changes");
    expect(hubspec(project, "config", "path").out.trim()).toBe(join(home, ".config", "hubspec", "config.json"));
    expect(existsSync(join(home, ".config", "openspec"))).toBe(false);
  });

  test("version: o hubspec e o OpenSpec que ele traz; sem telemetria nem install/feedback do OpenSpec", () => {
    const upstream = JSON.parse(readFileSync(join(ROOT, "src", "openspec", "UPSTREAM.json"), "utf8")) as { version: string };
    expect(hubspec(project, "version").out).toStartWith(`hubspec ${JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version} (OpenSpec ${upstream.version}`);
    expect(hubspec(project, "feedback", "x").err).toContain("unknown command 'feedback'");
    expect(hubspec(project, "install").err).toContain("unknown command 'install'");
    expect(readFileSync(CLI, "utf8")).not.toContain("posthog");
  });
});

describe("sem dependências", () => {
  test("o package.json não declara dependências", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, unknown>;
    expect(pkg["dependencies"]).toBeUndefined();
  });

  test("o pacote roda só com os arquivos que publica, sem node_modules", () => {
    const pkg = join(dir, "pacote");
    for (const f of ["dist", "schemas", "skills", "package.json"]) cpSync(join(ROOT, f), join(pkg, f), { recursive: true });
    const project = join(dir, "sem-deps");
    mkdirSync(project);
    const res = runCli(join(pkg, "dist", "cli.js"), project, "init", "--tools", "claude", "--no-animation");
    expect(res.code).toBe(0);
    expect(readdirSync(join(project, ".claude", "skills"))).toContain("hubspec-verify");
    expect(runCli(join(pkg, "dist", "cli.js"), project, "new", "change", "x").code).toBe(0);
    expect(JSON.parse(runCli(join(pkg, "dist", "cli.js"), project, "status", "--change", "x", "--json").out).schemaName).toBe("spec-driven");
  });
});
