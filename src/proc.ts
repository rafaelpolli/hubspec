import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export interface RunResult {
  ok: boolean;
  code: number;
  out: string;
  err: string;
}

/** Runs `argv` to the end without a shell, capturing its output. A missing program is code 127. */
export function run(argv: readonly string[], opts: { cwd?: string; env?: Record<string, string | undefined>; input?: string } = {}): RunResult {
  const res = spawnSync(argv[0]!, argv.slice(1), {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    input: opts.input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.error) return { ok: false, code: 127, out: "", err: res.error.message };
  const code = res.status ?? 1;
  return { ok: code === 0, code, out: res.stdout ?? "", err: res.stderr ?? "" };
}

/** `run`, throwing with the command's stderr when it fails. */
export function must(argv: readonly string[], opts: Parameters<typeof run>[1] = {}): string {
  const res = run(argv, opts);
  if (!res.ok) throw new Error(`${argv.slice(0, 2).join(" ")} falhou: ${(res.err || res.out).trim()}`);
  return res.out;
}

/** Runs `argv` with the terminal attached, resolving to its exit code. */
export function interactive(argv: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, stdio: "inherit" });
    child.on("error", () => resolve(127));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** The first executable named `name` on the PATH, like `which`. */
export function which(name: string): string | undefined {
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (!dir) continue;
    const path = join(dir, name);
    try {
      if (!statSync(path).isFile()) continue;
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      // not here
    }
  }
  return undefined;
}
