import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };

/** The command, which the OpenSpec code inside hubspec also uses as its own name. */
export const CLI_NAME = "hubspec";
export const PACKAGE_NAME: string = pkg.name;
export const PACKAGE_VERSION: string = pkg.version;

// The folder above `src/` in development, or above `dist/` in the package. The standalone
// binary has neither: its entry point extracts the files it embeds, the first time one is needed.
let resolveRoot: () => string = () => resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The folder holding `schemas/` and `skills/`. */
export function packageRoot(): string {
  return resolveRoot();
}

export function setPackageRoot(resolve: () => string): void {
  resolveRoot = resolve;
}
