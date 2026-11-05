// Type-checks everything at OpenSpec's strictness, then hubspec's own code at its stricter one:
// src/openspec/ keeps upstream's settings so its files stay as upstream wrote them.
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const tsc = join(ROOT, "node_modules", ".bin", "tsc");
const STRICT = ["--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--noImplicitOverride"];

function run(args: string[]): string[] {
  const res = spawnSync(tsc, ["--noEmit", "-p", ROOT, ...args], { encoding: "utf8" });
  return res.stdout.split("\n").filter((l) => /error TS\d+/.test(l));
}

const errors = [...run([]), ...run(STRICT).filter((l) => !l.startsWith(join("src", "openspec") + "/"))];
for (const e of new Set(errors)) console.error(e);
if (errors.length > 0) process.exit(1);
console.log("tsc ok");
