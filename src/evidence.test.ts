import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkEvidence } from "./evidence.ts";

const dir = mkdtempSync(join(tmpdir(), "hubspec-evidence-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const project = join(dir, "projeto");
mkdirSync(join(project, "src"), { recursive: true });
mkdirSync(join(dir, "outro"), { recursive: true });
writeFileSync(join(dir, "outro", "a.test.ts"), 'test("Confirmar", () => {});\n');
writeFileSync(
  join(project, "src", "init.test.ts"),
  [
    'describe("3.1 inicializar Git", () => {', // 1
    "  test(", // 2
    '    "Pré-visualização: node_modules and dist ignored",', // 3
    "    async () => {},", // 4
    "  );", // 5
    '  test("Arquivo \\"secreto\\" fica fora", () => {});', // 6
    "});", // 7
  ].join("\n"),
);
const ev = (file: string, line: number, name: string) => ({ file, line, name });

describe("conferência das evidências", () => {
  test("a valid evidence: the name a few lines after the declaration line", () => {
    const check = checkEvidence(project, ev("src/init.test.ts", 2, "Pré-visualização: node_modules and dist ignored"));
    expect(check).toEqual({
      ok: true,
      path: join(project, "src", "init.test.ts"),
      evidence: ev("src/init.test.ts", 2, "Pré-visualização: node_modules and dist ignored"),
    });
  });

  test("the describe prefix and escaped quotes are tolerated; the name found is kept", () => {
    const check = checkEvidence(project, ev("src/init.test.ts", 1, "3.1 inicializar Git > Pré-visualização: node_modules and dist ignored"));
    expect(check.ok && check.evidence.name).toBe("Pré-visualização: node_modules and dist ignored");
    const quoted = checkEvidence(project, ev("src/init.test.ts", 6, 'Arquivo \\"secreto\\" fica fora'));
    expect(quoted.ok).toBe(true);
  });

  test("Teste inexistente: a name far from the line, or a line past the end", () => {
    expect(checkEvidence(project, ev("src/init.test.ts", 7, "Arquivo"))).toEqual({ ok: false, reason: "o nome do teste não aparece perto da linha 7" });
    expect(checkEvidence(project, ev("src/init.test.ts", 200, "x y z"))).toEqual({
      ok: false,
      reason: "src/init.test.ts tem 7 linhas, e a evidência aponta a linha 200",
    });
  });

  test("Arquivo fora do projeto, a missing file, no evidence", () => {
    expect(checkEvidence(project, ev("../outro/a.test.ts", 1, "Confirmar"))).toEqual({ ok: false, reason: "../outro/a.test.ts está fora do projeto" });
    expect(checkEvidence(project, ev("src/nao.test.ts", 1, "Confirmar"))).toEqual({ ok: false, reason: "src/nao.test.ts não existe no projeto" });
    expect(checkEvidence(project, ev("src", 1, "Confirmar"))).toEqual({ ok: false, reason: "src não existe no projeto" });
    expect(checkEvidence(project, undefined)).toEqual({ ok: false, reason: "o agente não informou arquivo, linha e nome do teste" });
  });
});
