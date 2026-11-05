#!/usr/bin/env node
// hubspec: the OpenSpec CLI that lives in src/openspec/, with hubspec's commands added.
import { program, runCli } from "./openspec/cli/index.ts";
import { registerHubspecCommands } from "./commands.ts";

registerHubspecCommands(program);
runCli();
