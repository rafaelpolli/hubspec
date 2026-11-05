import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * The deterministic part of `hub document`: what a script can tell about a repo without an
 * LLM. The agent writes the docs from it (spec 7), so it must be stable and bounded.
 */
export interface Scan {
  tree: string;
  files: number;
  /** Files per language, most used first. */
  languages: Record<string, number>;
  manifests: Manifest[];
  endpoints: Endpoint[];
  /** OpenAPI, AsyncAPI, protobuf and GraphQL files: contracts to describe in interfaces.md. */
  contracts: string[];
  infra: string[];
  configs: string[];
  ci: string[];
  /** The scan stopped at a limit; the lists are partial. */
  truncated?: boolean;
}

export interface Manifest {
  file: string;
  kind: string;
  name?: string;
  dependencies: string[];
}

export interface Endpoint {
  file: string;
  line: number;
  method: string;
  path: string;
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", "target", "vendor", ".venv", "venv", "__pycache__", ".next", ".nuxt", "coverage", ".terraform", ".idea", ".vscode", ".gradle", "bin", "obj"]);
const MAX_FILES = 20_000;
const MAX_READ = 512 * 1024;
const MAX_ENDPOINTS = 300;
const TREE_DEPTH = 3;
const TREE_ENTRIES = 25;

const LANGUAGES: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".go": "Go", ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin", ".scala": "Scala",
  ".rb": "Ruby", ".php": "PHP", ".cs": "C#", ".fs": "F#", ".rs": "Rust", ".swift": "Swift",
  ".c": "C", ".h": "C", ".cpp": "C++", ".cc": "C++", ".hpp": "C++", ".dart": "Dart", ".ex": "Elixir", ".exs": "Elixir",
  ".tf": "Terraform", ".hcl": "HCL", ".sql": "SQL", ".sh": "Shell", ".vue": "Vue", ".svelte": "Svelte",
  ".css": "CSS", ".scss": "SCSS", ".html": "HTML", ".proto": "Protocol Buffers", ".graphql": "GraphQL", ".gql": "GraphQL",
};

/** Route declarations of common web frameworks: [regex, method group, path group]. */
const ROUTES: [RegExp, number, number][] = [
  [/\b(?:app|router|server|route|api|r)\.(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)['"`]/gi, 1, 2], // Express, Fastify, Koa, Hono
  [/@(Get|Post|Put|Patch|Delete)\(\s*['"`]?([^'"`)]*)['"`]?\s*\)/g, 1, 2], // NestJS
  [/@(?:app|router|bp|blueprint|api)\.(get|post|put|patch|delete|route)\(\s*['"]([^'"]+)['"]/gi, 1, 2], // FastAPI, Flask
  [/@(Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)"/g, 1, 2], // Spring
  [/\.(GET|POST|PUT|PATCH|DELETE)\(\s*"([^"]+)"/g, 1, 2], // Gin, Echo
  [/\b(HandleFunc|Handle)\(\s*"([^"]+)"/g, 1, 2], // net/http, gorilla/mux
];

function walk(root: string, visit: (rel: string, isDir: boolean) => boolean | void): boolean {
  let count = 0;
  const go = (dir: string): boolean => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isSymbolicLink()) continue;
      const path = join(dir, e.name);
      const rel = relative(root, path);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        visit(rel, true);
        if (!go(path)) return false;
      } else if (e.isFile()) {
        if (++count > MAX_FILES) return false;
        visit(rel, false);
      }
    }
    return true;
  };
  return go(root);
}

function read(root: string, rel: string): string | undefined {
  try {
    const path = join(root, rel);
    if (statSync(path).size > MAX_READ) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** The directory tree to `TREE_DEPTH` levels, with file counts, at most `TREE_ENTRIES` per folder. */
function tree(root: string): string {
  const lines: string[] = [];
  const go = (dir: string, depth: number, indent: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true }).filter((e) => !(e.isDirectory() && SKIP_DIRS.has(e.name)) && !e.isSymbolicLink());
    } catch {
      return;
    }
    const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs.slice(0, TREE_ENTRIES)) {
      lines.push(`${indent}${d.name}/`);
      if (depth < TREE_DEPTH) go(join(dir, d.name), depth + 1, `${indent}  `);
    }
    if (dirs.length > TREE_ENTRIES) lines.push(`${indent}… mais ${dirs.length - TREE_ENTRIES} pastas`);
    const shown = depth === 1 ? files.slice(0, TREE_ENTRIES) : [];
    for (const f of shown) lines.push(`${indent}${f.name}`);
    if (files.length > shown.length) lines.push(`${indent}(${files.length - shown.length} arquivos)`);
  };
  go(root, 1, "");
  return lines.join("\n");
}

const keys = (o: unknown) => (o && typeof o === "object" ? Object.keys(o) : []);

/** Name and dependencies of a dependency manifest, by its file name. */
function manifest(file: string, text: string): Manifest | undefined {
  const name = basename(file);
  try {
    switch (name) {
      case "package.json": {
        const pkg = JSON.parse(text) as Record<string, unknown>;
        return { file, kind: "npm", ...(typeof pkg["name"] === "string" ? { name: pkg["name"] } : {}), dependencies: [...keys(pkg["dependencies"]), ...keys(pkg["peerDependencies"])] };
      }
      case "go.mod": {
        const mod = /^module\s+(\S+)/m.exec(text)?.[1];
        const deps = [...text.matchAll(/^\s*(?:require\s+)?([\w.-]+\.[\w.-]+\/\S+)\s+v[\d.]/gm)].map((m) => m[1]!);
        return { file, kind: "go", ...(mod ? { name: mod } : {}), dependencies: [...new Set(deps)] };
      }
      case "requirements.txt":
        return { file, kind: "pip", dependencies: text.split("\n").map((l) => l.trim().split(/[<>=~![;\s]/)[0]!).filter((l) => l && !l.startsWith("#") && !l.startsWith("-")) };
      case "pyproject.toml": {
        const proj = /^name\s*=\s*"([^"]+)"/m.exec(text)?.[1];
        const block = /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(text)?.[1] ?? "";
        const poetry = /\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(text)?.[1] ?? "";
        const deps = [...block.matchAll(/"([A-Za-z0-9_.-]+)/g)].map((m) => m[1]!).concat([...poetry.matchAll(/^([A-Za-z0-9_.-]+)\s*=/gm)].map((m) => m[1]!).filter((d) => d !== "python"));
        return { file, kind: "python", ...(proj ? { name: proj } : {}), dependencies: [...new Set(deps)] };
      }
      case "pom.xml": {
        const artifact = /<artifactId>([^<]+)<\/artifactId>/.exec(text)?.[1];
        const deps = [...text.matchAll(/<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>/g)].map((m) => `${m[1]}:${m[2]}`);
        return { file, kind: "maven", ...(artifact ? { name: artifact } : {}), dependencies: deps };
      }
      case "build.gradle":
      case "build.gradle.kts":
        return { file, kind: "gradle", dependencies: [...text.matchAll(/(?:implementation|api|compileOnly|runtimeOnly)\s*\(?\s*["']([^"':]+:[^"':]+)/g)].map((m) => m[1]!) };
      case "Cargo.toml": {
        const crate = /^\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m.exec(text)?.[1];
        const block = /^\[dependencies\]([\s\S]*?)(?:\n\[|$)/m.exec(text)?.[1] ?? "";
        return { file, kind: "cargo", ...(crate ? { name: crate } : {}), dependencies: [...block.matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]!) };
      }
      case "composer.json": {
        const c = JSON.parse(text) as Record<string, unknown>;
        return { file, kind: "composer", ...(typeof c["name"] === "string" ? { name: c["name"] } : {}), dependencies: keys(c["require"]) };
      }
      case "Gemfile":
        return { file, kind: "bundler", dependencies: [...text.matchAll(/^\s*gem\s+['"]([^'"]+)/gm)].map((m) => m[1]!) };
      default:
        if (name.endsWith(".csproj")) {
          return { file, kind: "nuget", name: name.replace(/\.csproj$/, ""), dependencies: [...text.matchAll(/<PackageReference\s+Include="([^"]+)"/g)].map((m) => m[1]!) };
        }
        return undefined;
    }
  } catch {
    return { file, kind: name, dependencies: [] };
  }
}

function isContract(file: string, text: () => string | undefined): boolean {
  const name = basename(file).toLowerCase();
  if (/\.(proto|graphql|gql)$/.test(name)) return true;
  if (!/\.(ya?ml|json)$/.test(name)) return false;
  if (/^(openapi|swagger|asyncapi)/.test(name)) return true;
  const head = text()?.slice(0, 400) ?? "";
  if (/^\s*["']?(openapi|swagger|asyncapi)["']?\s*:/m.test(head)) return true;
  if (name.endsWith(".yaml") || name.endsWith(".yml")) {
    try {
      const doc = parseYaml(head) as Record<string, unknown> | null;
      return !!doc && ("openapi" in doc || "asyncapi" in doc);
    } catch {
      return false;
    }
  }
  return false;
}

const INFRA = (f: string) => /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml|Chart\.yaml|serverless\.ya?ml|Procfile)$/.test(f) || f.endsWith(".tf") || /(^|\/)(k8s|kubernetes|helm|deploy|infra)\/.+\.ya?ml$/.test(f);
const CONFIG = (f: string) => /(^|\/)(\.env\.example|\.env\.sample|application(-\w+)?\.(ya?ml|properties)|appsettings(\.\w+)?\.json|settings\.py|config\.(ya?ml|json|toml))$/.test(f) || /(^|\/)config\/[^/]+$/.test(f);
const CI = (f: string) => /^\.github\/workflows\/.+\.ya?ml$/.test(f) || /(^|\/)(\.gitlab-ci\.yml|Jenkinsfile|azure-pipelines\.yml|\.circleci\/config\.yml)$/.test(f);
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rb|php|cs)$/;

/** Scans a repo's working tree. Never runs anything in it. */
export function scanRepo(root: string): Scan {
  const files: string[] = [];
  const complete = walk(root, (rel, isDir) => {
    if (!isDir) files.push(rel.split("\\").join("/"));
  });
  const languages: Record<string, number> = {};
  const manifests: Manifest[] = [];
  const endpoints: Endpoint[] = [];
  const contracts: string[] = [];
  const infra: string[] = [];
  const configs: string[] = [];
  const ci: string[] = [];
  for (const f of files) {
    const lang = LANGUAGES[extname(f).toLowerCase()];
    if (lang) languages[lang] = (languages[lang] ?? 0) + 1;
    let cached: string | undefined | null = null;
    const text = () => (cached === null ? (cached = read(root, f)) : cached);
    const m = /(^|\/)(package\.json|go\.mod|requirements\.txt|pyproject\.toml|pom\.xml|build\.gradle(\.kts)?|Cargo\.toml|composer\.json|Gemfile|[^/]+\.csproj)$/.test(f) ? text() : undefined;
    if (m !== undefined) {
      const parsed = manifest(f, m);
      if (parsed) manifests.push(parsed);
    }
    if (isContract(f, text)) contracts.push(f);
    if (INFRA(f)) infra.push(f);
    if (CONFIG(f)) configs.push(f);
    if (CI(f)) ci.push(f);
    if (CODE.test(f) && endpoints.length < MAX_ENDPOINTS && !/(\.test\.|\.spec\.|(^|\/)(tests?|__tests__)\/)/.test(f)) {
      const src = text();
      if (!src) continue;
      for (const [re, mi, pi] of ROUTES) {
        for (const match of src.matchAll(re)) {
          if (endpoints.length >= MAX_ENDPOINTS) break;
          const line = src.slice(0, match.index).split("\n").length;
          endpoints.push({ file: f, line, method: match[mi]!.toUpperCase(), path: match[pi]! || "/" });
        }
      }
    }
  }
  const sorted = Object.fromEntries(Object.entries(languages).sort((a, b) => b[1] - a[1]));
  endpoints.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return {
    tree: tree(root),
    files: files.length,
    languages: sorted,
    manifests,
    endpoints,
    contracts,
    infra,
    configs,
    ci,
    ...(complete && endpoints.length < MAX_ENDPOINTS ? {} : { truncated: true }),
  };
}
