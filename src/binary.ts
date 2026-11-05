// Entry point of the standalone binary (`bun scripts/build.ts --binary`). The binary has no
// package folder on disk, so schemas/ and skills/ are embedded at build time and written to a
// real folder the first time a command needs them. Follows OpenSpec's scripts/binary/entry.mjs.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setPackageRoot } from "./package.ts";
import { getGlobalDataDir } from "./openspec/core/global-config.ts";
import { markStandaloneBinary } from "./openspec/core/version-check.ts";

// Replaced by the build: { hash, files: { "schemas/spec-driven/schema.yaml": "...", ... } }
declare const HUBSPEC_EMBEDDED: { hash: string; files: Record<string, string> };
const { hash, files } = HUBSPEC_EMBEDDED;

// Checked on every start, so a copy someone edited or partly deleted is replaced.
function isIntact(dir: string): boolean {
  try {
    return Object.entries(files).every(([path, content]) => readFileSync(join(dir, path), "utf8") === content);
  } catch {
    return false;
  }
}

function writeFiles(dir: string): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

// Keyed by content and created by renaming a fully written copy, so concurrent first runs
// never see half of it.
function extractToDataDir(): string {
  const dir = join(getGlobalDataDir(), "binary-files", hash);
  if (isIntact(dir)) return dir;
  mkdirSync(dirname(dir), { recursive: true });
  const tmp = writeFiles(mkdtempSync(`${dir}.tmp-`));
  if (existsSync(dir)) {
    try {
      renameSync(dir, `${tmp}-stale`);
    } catch {}
    rmSync(`${tmp}-stale`, { recursive: true, force: true });
  }
  try {
    renameSync(tmp, dir);
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    if (!isIntact(dir)) throw error; // another process finished first; its copy is identical
  }
  return dir;
}

function extract(): string {
  try {
    return extractToDataDir();
  } catch {
    // A read-only home: a private copy for this run only.
    const dir = writeFiles(mkdtempSync(join(tmpdir(), "hubspec-files-")));
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
    return dir;
  }
}

markStandaloneBinary(process.execPath);
let root: string | undefined;
setPackageRoot(() => {
  try {
    return (root ??= extract());
  } catch (error) {
    throw new Error(`não foi possível gravar os arquivos embutidos do hubspec: ${(error as Error).message}`);
  }
});
await import("./cli.ts");
