import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
export function git(cwd: string, ...args: string[]) {
  const res = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...ENV } });
  if (res.exitCode !== 0) throw new Error(res.stderr.toString());
}

export const SPEC = `## ADDED Requirements

### Requirement: Soma
A calculadora SHALL somar dois números.

#### Scenario: Soma simples
- **WHEN** soma(2, 3)
- **THEN** o resultado é 5

#### Scenario: Visual da tela
- **WHEN** o usuário abre a tela
- **THEN** vê o resultado em destaque
`;

export const SOMA = "soma/Soma/Soma simples";
export const VISUAL = "soma/Soma/Visual da tela";

/** A Git project with a wrong `soma` committed, and a change "add-soma" with its spec and test. */
export function project(dir: string, name: string): { root: string; change: string } {
  const root = join(dir, name);
  const change = join(root, "openspec", "changes", "add-soma");
  mkdirSync(join(change, "specs", "soma"), { recursive: true });
  mkdirSync(join(root, "openspec", "specs"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name, scripts: { test: "bun test" } }));
  writeFileSync(join(root, "calc.ts"), "export const soma = (a: number, b: number) => a - b;\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "calc");
  writeFileSync(join(change, "proposal.md"), "## Why\n\nSomar.\n");
  writeFileSync(join(change, "specs", "soma", "spec.md"), SPEC);
  writeFileSync(join(change, "tasks.md"), "## 1. Soma\n\n- [x] 1.1 Corrigir soma\n- [ ] 1.2 Revisar\n");
  writeFileSync(
    join(root, "calc.test.ts"),
    ['import { expect, test } from "bun:test";', 'import { soma } from "./calc.ts";', "", 'test("soma 2 + 3", () => {', "  expect(soma(2, 3)).toBe(5);", "});", ""].join("\n"),
  );
  mkdirSync(join(change, ".hubspec"));
  writeFileSync(
    join(change, ".hubspec", "trace.json"),
    JSON.stringify({ items: [{ id: SOMA, kind: "teste", file: "calc.test.ts", line: 4, name: "soma 2 + 3" }, { id: VISUAL, kind: "manual", note: "visual" }] }),
  );
  return { root, change };
}

export const fix = (root: string) => writeFileSync(join(root, "calc.ts"), "export const soma = (a: number, b: number) => a + b;\n");
