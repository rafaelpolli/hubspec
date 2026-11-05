import type { CommandDefinition } from "./openspec/core/completions/types.ts";

const json = { name: "json", description: "Saída em JSON" };

/** hubspec's commands, for the shell completions OpenSpec generates. */
export const HUBSPEC_COMMANDS: CommandDefinition[] = [
  {
    name: "scenarios",
    description: "Os cenários das delta specs da change",
    acceptsPositional: true,
    positionalType: "change-id",
    positionals: [{ name: "change", type: "change-id" }],
    flags: [json, { name: "template", description: "Cria o trace para preencher" }],
  },
  {
    name: "verify",
    description: "Roda os testes do trace e escreve verification.md",
    acceptsPositional: true,
    positionalType: "change-id",
    positionals: [{ name: "change", type: "change-id" }],
    flags: [
      json,
      { name: "prove", description: "Prova que cada teste falhava antes da change" },
      { name: "timeout", description: "Tempo máximo de cada teste, em segundos", takesValue: true },
    ],
  },
  {
    name: "check",
    description: "Confirma um item manual da verificação",
    acceptsPositional: true,
    positionalType: "change-id",
    positionals: [{ name: "change", type: "change-id" }, { name: "n" }],
    flags: [{ name: "note", description: "Como foi conferido", takesValue: true }],
  },
  {
    name: "justify",
    description: "Justifica um item em CONCERNS",
    acceptsPositional: true,
    positionalType: "change-id",
    positionals: [{ name: "change", type: "change-id" }, { name: "n" }, { name: "texto" }],
    flags: [],
  },
  {
    name: "gate",
    description: "O portão do archive",
    acceptsPositional: true,
    positionalType: "change-id",
    positionals: [{ name: "change", type: "change-id" }],
    flags: [json],
  },
  {
    name: "hub",
    description: "Hub multi-repo",
    flags: [],
    subcommands: ["init", "add", "sync", "document", "depends", "status", "pr", "archive", "remove", "help"].map((name) => ({ name, description: `hubspec hub ${name}`, flags: [] })),
  },
];
