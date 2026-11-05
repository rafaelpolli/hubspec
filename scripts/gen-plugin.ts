// Writes the Claude Code plugin's commands from the same source as `hub init`'s adapters.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COMMANDS, renderCommand } from "../src/hub/agents.ts";

const root = resolve(import.meta.dir, "..");
for (const cmd of Object.keys(COMMANDS)) {
  const { text } = renderCommand("claude", cmd);
  mkdirSync(join(root, "commands", "hub"), { recursive: true });
  writeFileSync(join(root, "commands", "hub", `${cmd}.md`), text);
}
