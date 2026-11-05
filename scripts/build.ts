// Builds hubspec as one file with no dependencies, dist/cli.js, which Node runs (the npm package).
// With --binary, standalone executables that need no Node either: dist-bin/hubspec-<target>.
//
//   bun scripts/build.ts
//   bun scripts/build.ts --binary                  # this machine
//   bun scripts/build.ts --binary linux-arm64 ...  # named targets (Bun downloads their runtime)
import { chmodSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import type { BunPlugin } from "bun";

const ROOT = resolve(import.meta.dir, "..");

// Release target → Bun target, as OpenSpec's scripts/binary/build.mjs ships them.
const TARGETS: Record<string, string> = {
  "linux-x64": "bun-linux-x64-baseline",
  "linux-arm64": "bun-linux-arm64",
  "linux-x64-musl": "bun-linux-x64-musl-baseline",
  "linux-arm64-musl": "bun-linux-arm64-musl",
  "darwin-x64": "bun-darwin-x64-baseline",
  "darwin-arm64": "bun-darwin-arm64",
  "windows-x64": "bun-windows-x64-baseline",
  "windows-arm64": "bun-windows-arm64",
};

// OpenSpec loads cross-spawn with `createRequire(import.meta.url)`, which Node resolves at
// runtime against a node_modules the bundle does not have. A plain `require` gets bundled.
const staticRequire: BunPlugin = {
  name: "static-require",
  setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/]openspec[\\/].*\.ts$/ }, async (args) => {
      const contents = (await Bun.file(args.path).text())
        .replace(/const require = createRequire\(import\.meta\.url\);/g, "")
        .replaceAll("createRequire(import.meta.url)(", "require(");
      if (contents.includes("createRequire(import.meta.url)")) throw new Error(`createRequire(import.meta.url) não tratado em ${args.path}`);
      return { contents, loader: "ts" };
    });
  },
};

function fail(logs: readonly unknown[]): never {
  for (const log of logs) console.error(log);
  process.exit(1);
}

/** Bun resolves some paths at build time; one baked in would point at this machine. */
function assertNoBuildPath(file: string): void {
  if (readFileSync(file).includes(ROOT)) fail([`${relative(ROOT, file)} contém o caminho do build ${ROOT}`]);
}

/** The npm packages that went into the bundle, from its inputs. */
function bundledPackages(inputs: string[]): string[] {
  const names = new Set<string>();
  for (const input of inputs) {
    const parts = input.split(/[\\/]/);
    const i = parts.lastIndexOf("node_modules");
    if (i < 0) continue;
    names.add(parts[i + 1]!.startsWith("@") ? `${parts[i + 1]}/${parts[i + 2]}` : parts[i + 1]!);
  }
  return [...names].sort();
}

/** THIRD_PARTY_LICENSES.md: the license of every package the bundle carries. */
function writeLicenses(packages: string[]): void {
  const sections = packages.map((name) => {
    const dir = join(ROOT, "node_modules", name);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string; license?: string };
    const file = readdirSync(dir).find((f) => /^(license|licence|copying)(\.|$)/i.test(f));
    const text = file ? readFileSync(join(dir, file), "utf8").trim() : `Licença: ${pkg.license ?? "não declarada"}`;
    return `## ${name}@${pkg.version} (${pkg.license ?? "?"})\n\n\`\`\`\n${text}\n\`\`\``;
  });
  const openspec = JSON.parse(readFileSync(join(ROOT, "src", "openspec", "UPSTREAM.json"), "utf8")) as { version: string; repository: string };
  const upstream = `## OpenSpec ${openspec.version} (MIT), em src/openspec/ e schemas/\n\n${openspec.repository}\n\n\`\`\`\n${readFileSync(join(ROOT, "src", "openspec", "LICENSE"), "utf8").trim()}\n\`\`\``;
  writeFileSync(
    join(ROOT, "THIRD_PARTY_LICENSES.md"),
    `# Licenças de terceiros\n\nO hubspec traz dentro dele o código do OpenSpec e os pacotes abaixo, empacotados em dist/cli.js (gerado por scripts/build.ts).\n\n${[upstream, ...sections].join("\n\n")}\n`,
  );
}

async function buildPackage(): Promise<void> {
  rmSync(join(ROOT, "dist"), { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [join(ROOT, "src", "cli.ts")],
    outdir: join(ROOT, "dist"),
    naming: "cli.js",
    target: "node",
    format: "esm",
    // Unminified: a crash names the real function, so bug reports are actionable.
    minify: false,
    metafile: true,
    plugins: [staticRequire],
  });
  if (!result.success) fail(result.logs);
  const out = join(ROOT, "dist", "cli.js");
  const text = readFileSync(out, "utf8");
  if (!text.startsWith("#!")) writeFileSync(out, `#!/usr/bin/env node\n${text}`);
  chmodSync(out, 0o755);
  assertNoBuildPath(out);
  writeLicenses(bundledPackages(Object.keys(result.metafile?.inputs ?? {})));
  console.log(`dist/cli.js (${Math.round(statSync(out).size / 1024)} KB)`);
}

/** schemas/ and skills/, which the binary carries as text. Sorted, so the hash is stable. */
function embeddedFiles(): { hash: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  for (const file of ["schemas", "skills"].flatMap((d) => walk(join(ROOT, d))).sort()) {
    const bytes = readFileSync(file);
    const content = bytes.toString("utf8");
    if (!Buffer.from(content, "utf8").equals(bytes)) fail([`${relative(ROOT, file)} não é texto UTF-8 e não pode ser embutido`]);
    files[relative(ROOT, file).split(sep).join("/")] = content;
  }
  return { hash: createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 16), files };
}

async function buildBinaries(names: string[]): Promise<void> {
  const host = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  // This machine's binary reuses the running Bun; a named target downloads that target's runtime.
  const targets = names.length > 0 ? names : [host];
  for (const t of names) if (!TARGETS[t]) fail([`alvo desconhecido ${t}; conhecidos: ${Object.keys(TARGETS).join(", ")}`]);
  const embedded = embeddedFiles();
  for (const t of targets) {
    const outfile = join(ROOT, "dist-bin", `hubspec-${t}${t.startsWith("windows") ? ".exe" : ""}`);
    const result = await Bun.build({
      entrypoints: [join(ROOT, "src", "binary.ts")],
      compile: names.length > 0 ? { target: TARGETS[t] as Bun.Build.CompileTarget, outfile } : { outfile },
      minify: false,
      define: { HUBSPEC_EMBEDDED: JSON.stringify(embedded) },
      plugins: [staticRequire],
    });
    if (!result.success) fail(result.logs);
    assertNoBuildPath(outfile);
    console.log(`${relative(ROOT, outfile)} (${Math.round(statSync(outfile).size / 1024 / 1024)} MB)`);
  }
}

const args = process.argv.slice(2);
const binary = args.includes("--binary");
const targets = args.filter((a) => a !== "--binary");
if (!binary && targets.length > 0) fail([`argumentos desconhecidos: ${targets.join(" ")}`]);
await buildPackage();
if (binary) await buildBinaries(targets);
