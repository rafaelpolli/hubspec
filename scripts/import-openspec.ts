// Imports an OpenSpec release into src/openspec/ and schemas/, renaming its CLI to hubspec.
//
//   bun scripts/import-openspec.ts <checkout of github.com/Fission-AI/OpenSpec at a release tag> [into]
//
// The import replaces src/openspec/ and schemas/ wholesale, so point `into` at a worktree of the
// openspec-upstream branch and merge that into main: hubspec's own patches (FORK.md) live only on main.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [from, into] = process.argv.slice(2);
if (!from) {
  console.error("uso: bun scripts/import-openspec.ts <checkout do OpenSpec> [destino, padrão: este repositório]");
  process.exit(1);
}
const ROOT = into ? resolve(into) : resolve(import.meta.dir, "..");
const DEST = join(ROOT, "src", "openspec");
const upstream = resolve(from);
const pkg = JSON.parse(readFileSync(join(upstream, "package.json"), "utf8")) as { name: string; version: string };
if (pkg.name !== "@fission-ai/openspec" || !existsSync(join(upstream, "src", "cli", "index.ts"))) {
  console.error(`${upstream} não é um checkout do OpenSpec`);
  process.exit(1);
}
const commit = spawnSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();

rmSync(DEST, { recursive: true, force: true });
rmSync(join(ROOT, "schemas"), { recursive: true, force: true });
cpSync(join(upstream, "src"), DEST, { recursive: true });
cpSync(join(upstream, "schemas"), join(ROOT, "schemas"), { recursive: true });
cpSync(join(upstream, "LICENSE"), join(DEST, "LICENSE"));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

// The top-level command names, so `openspec <command>` in messages and skill text says hubspec,
// while `openspec/` paths, the openspec-* skill names and "OpenSpec" in prose stay.
const cliFiles = [join(DEST, "cli", "index.ts"), ...files(join(DEST, "cli", "commands"))];
const commands = new Set(cliFiles.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/\.command\('([a-z_-]+)/g)].map((m) => m[1]!)));
const invocation = new RegExp(`\\bopenspec(?= (?:${[...commands].join("|")})\\b| --?[a-zA-Z])`, "g");

// Shell completions name the command, their functions and their profile markers after it.
const completion = (f: string) => f.includes(join("core", "completions")) || f.endsWith(join("commands", "completion.ts"));

let changed = 0;
for (const file of files(DEST)) {
  const before = readFileSync(file, "utf8");
  let text = before
    .replace(invocation, "hubspec")
    .replace(/\bopenspec(?= \$\{)/g, "hubspec")
    .replace(/the (\\?`)openspec\1 CLI/g, "the $1hubspec$1 CLI")
    .replaceAll("npm install -g @fission-ai/openspec", "npm install -g hubspec")
    .replaceAll("Bash(openspec:*)", "Bash(hubspec:*)")
    .replaceAll("Requires openspec CLI.", "Requires hubspec CLI.");
  if (completion(file)) {
    text = text
      .replace(/(?<![\w/.-])openspec(?![/-])|(?<=_)openspec|(?<=\$)openspec/g, "hubspec")
      .replaceAll("OPENSPEC:", "HUBSPEC:")
      .replaceAll("OpenSpecCompletion", "HubspecCompletion")
      .replace(/OpenSpec (shell )?completion/g, "hubspec $1completion");
  }
  if (text !== before) {
    writeFileSync(file, text);
    changed++;
  }
}

writeFileSync(join(DEST, "UPSTREAM.json"), `${JSON.stringify({ repository: "https://github.com/Fission-AI/OpenSpec", version: pkg.version, commit }, null, 2)}\n`);
console.log(`OpenSpec ${pkg.version} (${commit.slice(0, 7)}) em src/openspec/: ${files(DEST).length} arquivos, ${changed} renomeados para hubspec`);
