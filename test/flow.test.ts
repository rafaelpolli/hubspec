import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pendingTasks } from "../src/tasks.ts";
import { fix, git, project as fixture, SOMA, SPEC, VISUAL } from "./fixture.ts";
import { parseTrace, TraceError } from "../src/trace.ts";
import { verdictOf } from "../src/types.ts";
import { check, FlowError, findProject, gate, justify, verify } from "../src/verify.ts";

setDefaultTimeout(60_000);

const dir = mkdtempSync(join(tmpdir(), "hubspec-flow-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const project = (name: string) => fixture(dir, name);

describe("verificação da change", () => {
  test("com o bug: FAIL, o relatório e o portão fechado", async () => {
    const { root, change } = project("bug");
    const record = await verify(root, "add-soma");
    expect(record.items.map((i) => [i.id, i.result])).toEqual([
      [SOMA, "falhou"],
      [VISUAL, "manual"],
      ["tasks-pendentes", "sem-teste"],
    ]);
    expect(verdictOf(record.items)).toBe("FAIL");
    const md = readFileSync(join(change, "verification.md"), "utf8");
    expect(md).toContain("- Veredito: **FAIL**");
    expect(md).toContain('| 1 | Soma simples | `calc.test.ts:4` "soma 2 + 3" | falhou | - |');
    expect(gate(root, "add-soma")).toMatchObject({ allowed: false, reason: "há testes falhando: corrija e verifique de novo" });
  });

  test("corrigido: CONCERNS até conferir o manual e justificar as tasks; depois o portão abre", async () => {
    const { root } = project("ok");
    fix(root);
    const record = await verify(root, "add-soma");
    expect(record.items[0]!.result).toBe("coberto");
    expect(verdictOf(record.items)).toBe("CONCERNS");
    expect(gate(root, "add-soma")).toMatchObject({ allowed: false, missing: [2, 3] });
    expect(() => check(root, "add-soma", "1")).toThrow(FlowError);
    check(root, "add-soma", "#2", "conferi na tela");
    justify(root, "add-soma", "3", "1.2 é só revisão");
    expect(gate(root, "add-soma")).toEqual({ allowed: true, verdict: "CONCERNS", missing: [] });
    expect(readFileSync(join(root, "openspec/changes/add-soma/verification.md"), "utf8")).toContain("- **Visual da tela**: conferido — conferi na tela");
  });

  test("verificação desatualizada: mudar a spec ou o código fecha o portão", async () => {
    const { root, change } = project("stale");
    fix(root);
    writeFileSync(join(change, "tasks.md"), "## 1. Soma\n\n- [x] 1.1 Corrigir soma\n");
    writeFileSync(join(change, ".hubspec", "trace.json"), JSON.stringify({ items: [{ id: SOMA, kind: "teste", file: "calc.test.ts", line: 4, name: "soma 2 + 3" }] }));
    writeFileSync(join(change, "specs", "soma", "spec.md"), SPEC.split("#### Scenario: Visual")[0]!);
    const record = await verify(root, "add-soma");
    expect(verdictOf(record.items)).toBe("PASS");
    expect(gate(root, "add-soma").allowed).toBe(true);
    writeFileSync(join(change, "specs", "soma", "spec.md"), `${SPEC}\n`);
    expect(gate(root, "add-soma").reason).toBe("o código ou os artefatos mudaram depois da verificação: verifique de novo");
    await verify(root, "add-soma");
    writeFileSync(join(root, "calc.ts"), "export const soma = (a: number, b: number) => b + a;\n");
    expect(gate(root, "add-soma").allowed).toBe(false);
  });

  test("evidência inválida e trace ausente", async () => {
    const { root, change } = project("evidence");
    writeFileSync(join(change, ".hubspec", "trace.json"), JSON.stringify({ items: [{ id: SOMA, kind: "teste", file: "calc.test.ts", line: 1, name: "outro teste" }] }));
    const record = await verify(root, "add-soma");
    expect(record.items[0]).toMatchObject({ result: "evidencia-invalida", reason: "o nome do teste não aparece perto da linha 1" });
    expect(record.items[1]).toMatchObject({ id: VISUAL, result: "sem-teste" });
    rmSync(join(change, ".hubspec", "trace.json"));
    await expect(verify(root, "add-soma")).rejects.toThrow("falta .hubspec/trace.json");
  });

  test("prova vermelho → verde: forte contra o commit com o bug", async () => {
    const { root } = project("prove");
    fix(root);
    const record = await verify(root, "add-soma", { proveBase: "HEAD" });
    expect(record.items[0]!.proof).toEqual({ status: "concluida", result: "forte" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "fix");
    await expect(verify(root, "add-soma", { proveBase: "HEAD" })).rejects.toThrow("o código não mudou desde HEAD");
  });

  test("findProject sobe até a pasta com openspec/", () => {
    const { root } = project("find");
    expect(findProject(join(root, "openspec", "changes"))).toBe(root);
  });
});

describe("trace e tasks", () => {
  const scenarios = [{ id: "a/R/S", capability: "a", requirement: "R", name: "S", text: "" }];
  test("ids desconhecidos ignorados, cenário sem resposta vira sem-teste, JSON inválido falha", () => {
    expect(parseTrace(JSON.stringify({ items: [{ id: "x", kind: "manual" }] }), scenarios).get("a/R/S")).toEqual({ trace: "sem-teste" });
    expect(() => parseTrace("{", scenarios)).toThrow(TraceError);
    expect(() => parseTrace(JSON.stringify({ items: [{ id: "a/R/S", kind: "talvez" }] }), scenarios)).toThrow(TraceError);
  });
  test("tasks pendentes por id, ou pela linha", () => {
    expect(pendingTasks("## 1. A\n- [x] 1.1 a\n- [ ] 1.2 b\n- [~] sem id\n- [X] 1.3 c\n")).toEqual(["1.2", "linha 4"]);
  });
});
