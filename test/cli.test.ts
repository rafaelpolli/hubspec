import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fix, project } from "./fixture.ts";

setDefaultTimeout(120_000);

const dir = mkdtempSync(join(tmpdir(), "hubspec-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The built CLI under Node, as users run it (`bun test` builds it first, in pretest).
const CLI = resolve(import.meta.dir, "..", "dist", "cli.js");
const home = join(dir, "home");
mkdirSync(home);

function hubspec(cwd: string, ...args: string[]) {
  const res = Bun.spawnSync(["node", CLI, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"), NO_COLOR: "1" },
  });
  return { code: res.exitCode, out: res.stdout.toString(), err: res.stderr.toString() };
}

describe("o fluxo pelo CLI", () => {
  const { root } = project(dir, "calc");

  test("init, scenarios lista os ids", () => {
    expect(hubspec(root, "init", "--tools", "none", "--no-animation").code).toBe(0);
    const res = hubspec(root, "scenarios", "add-soma", "--json");
    expect(JSON.parse(res.out).map((s: { id: string }) => s.id)).toEqual(["soma/Soma/Soma simples", "soma/Soma/Visual da tela"]);
  });

  test("verify: FAIL (saída 1) com o bug; archive recusado pelo portão", () => {
    const res = hubspec(root, "verify", "add-soma");
    expect(res.code).toBe(1);
    expect(res.out).toContain("Veredito: FAIL");
    expect(res.out).toContain("#1 FALHOU: Soma simples");
    const archive = hubspec(root, "archive", "add-soma", "-y");
    expect(archive.code).toBe(1);
    expect(archive.err).toContain("Portão fechado para 'add-soma': há testes falhando");
    const json = JSON.parse(hubspec(root, "archive", "add-soma", "--json").out);
    expect(json.status[0]).toMatchObject({ code: "archive_gate_closed", fix: "hubspec verify add-soma" });
  });

  test("corrigido: CONCERNS (saída 2); check + justify; gate liberado; archive move a change", () => {
    fix(root);
    expect(hubspec(root, "verify", "add-soma").code).toBe(2);
    expect(hubspec(root, "gate", "add-soma").out).toContain("justifique os itens que deixam o veredito em CONCERNS (#2, #3)");
    expect(hubspec(root, "check", "add-soma", "2", "--note", "conferi").code).toBe(0);
    expect(hubspec(root, "justify", "add-soma", "3", "revisão", "fica", "para", "depois").out).toContain("[justificado]");
    expect(hubspec(root, "gate", "add-soma")).toMatchObject({ code: 0, out: "Portão liberado (CONCERNS).\n" });
    const archive = hubspec(root, "archive", "add-soma", "-y");
    expect(archive.code).toBe(0);
    expect(existsSync(join(root, "openspec", "changes", "add-soma"))).toBe(false);
    const archived = readdirSync(join(root, "openspec", "changes", "archive"));
    expect(archived.some((n) => n.endsWith("-add-soma"))).toBe(true);
    expect(existsSync(join(root, "openspec", "specs", "soma", "spec.md"))).toBe(true);
  });

  test("erros dizem o que fazer", () => {
    expect(hubspec(root, "verify", "nao-existe").err).toContain("a change nao-existe não existe em openspec/changes");
    expect(hubspec(dir, "gate", "x").err).toContain("nenhuma pasta openspec/ encontrada");
  });
});
