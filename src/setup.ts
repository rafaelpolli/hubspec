import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { packageRoot } from "./package.ts";
import { AI_TOOLS } from "./openspec/core/config.ts";
import { getConfiguredTools } from "./openspec/core/shared/tool-detection.ts";
import { resolveToolSkillsDir, toolSupportsSkills } from "./openspec/core/shared/skill-paths.ts";
import { ADAPTER_TOOLS, writeAdapters, type Tool } from "./hub/agents.ts";
import { findHub } from "./hub/manifest.ts";

/** The skills shipped with hubspec, by name, as the text of their SKILL.md. */
export function skills(): Record<string, string> {
  const dir = join(packageRoot(), "skills");
  return Object.fromEntries(
    readdirSync(dir)
      .filter((n) => n.startsWith("hubspec-") && existsSync(join(dir, n, "SKILL.md")))
      .sort()
      .map((n) => [n, readFileSync(join(dir, n, "SKILL.md"), "utf8")]),
  );
}

/** Writes hubspec's skills into a tool's skills folder, replacing only hubspec's own. */
export function copySkills(skillsDir: string): string[] {
  return Object.entries(skills()).map(([name, text]) => {
    const dest = join(skillsDir, name);
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "SKILL.md"), text);
    return dest;
  });
}

/**
 * hubspec's part of `init` and `update`: its skills next to the openspec-* ones of every tool
 * the project has set up and, in a hub, the agents' adapters. Returns the folders written.
 */
export function installHubspecSkills(project: string, log: (line: string) => void = (l) => console.log(l)): string[] {
  if (!existsSync(join(project, "openspec"))) return [];
  const configured = getConfiguredTools(project);
  const dirs = new Set<string>();
  for (const tool of AI_TOOLS) {
    if (configured.includes(tool.value) && toolSupportsSkills(tool)) dirs.add(resolveToolSkillsDir(project, tool));
  }
  const written: string[] = [];
  for (const dir of dirs) {
    copySkills(dir);
    written.push(dir);
  }
  if (written.length > 0) log(`hubspec: skills hubspec-* em ${written.map((d) => relative(project, d) || d).join(", ")}`);
  if (findHub(project) === project) {
    const tools = ADAPTER_TOOLS.filter((t): t is Tool => configured.includes(t));
    for (const path of writeAdapters(project, tools)) log(`hubspec: escrito ${path}`);
  }
  return written;
}
