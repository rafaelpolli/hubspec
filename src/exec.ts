import { spawn } from "node:child_process";

export interface ExecResult {
  exitCode: number;
  timedOut: boolean;
  /** stdout and stderr together, trimmed to the last lines. */
  output: string;
}

/** Lines of a test's output kept in the report data. */
const TAIL = 60;

const tail = (text: string) => text.trimEnd().split("\n").slice(-TAIL).join("\n");

/** Runs `argv` in `cwd` without a shell, killing it after `timeoutMs`. */
export function exec(argv: string[], opts: { cwd: string; timeoutMs: number }): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1", NO_COLOR: "1" } });
    let output = "";
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, timedOut: false, output: `não foi possível rodar ${argv[0]}: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, timedOut, output: tail(output) });
    });
  });
}
