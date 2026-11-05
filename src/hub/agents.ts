import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeHubConfig } from "./openspec-config.ts";

const START = "<!-- hubspec:inicio -->";
const END = "<!-- hubspec:fim -->";

/** The four sections of AGENTS.md (spec 8.1): the common entry point of the four agents. */
export const AGENTS_SECTION = `${START}
# Hub do sistema

## 1. O que é o hub

Este repositório é o **hub** do sistema: ele guarda o mapa do sistema, não o código.

- \`repos.yaml\` lista os repositórios do sistema: URL, branch, descrição, tags e dependências entre eles.
- \`docs/system-overview.md\` é a visão do sistema e o mapa de dependências; \`docs/repos/<repo>/\` tem a visão geral, a arquitetura e as interfaces de cada repo.
- \`openspec/\` guarda as specs vigentes do sistema e as changes em andamento.
- O código real fica nos clones em \`workspace/<repo>/\` (fora do Git do hub). Se faltar um clone, rode \`hubspec hub sync\`.

## 2. Como se orientar

Antes de responder sobre o sistema ou propor uma mudança:

1. Leia \`docs/system-overview.md\`.
2. Leia as docs dos repos envolvidos em \`docs/repos/<repo>/\` (overview, depois architecture e interfaces).
3. Só abra o código em \`workspace/<repo>/\` quando a documentação não bastar, e diga que a doc estava incompleta.

Se \`hubspec hub status\` mostrar a doc de um repo desatualizada, avise antes de confiar nela.

## 3. Regras para changes

Uma mudança que atravessa repos é **uma change só** no \`openspec/\` do hub.

- Toda task de \`tasks.md\` começa pelo repo entre colchetes e indica o componente ou caminho alvo:
  \`- [ ] 2.1 [api] Publicar o evento PixRecebido — \\\`src/events/\\\`\`
- Agrupe as tasks por repo (\`## 2. api\`), na ordem de dependência: primeiro quem os outros consomem (contrato, lib, API), depois quem consome. Declare as dependências entre repos da change no título da seção: \`## 3. worker (depende de: api)\`. O \`hub pr\` usa essas dependências, mais as do \`repos.yaml\`, para a ordem de merge.
- Repo novo não é criado pelo agente: é criado pela automação da organização (issue no GitHub). A primeira task é \`[manual]\` ("criar repo via issue na automação da organização") e **bloqueia as demais**: não implemente nada antes dela estar concluída. O \`hub pr\` recusa enquanto houver task \`[manual]\` aberta.
- Um repo com \`template: true\` no \`repos.yaml\` já tem a estrutura do template: siga essa estrutura e não a recrie.
- Implemente cada task dentro do clone do repo indicado, em \`workspace/<repo>/\`.

## 4. Comandos

- \`hubspec hub sync\`: clona ou atualiza os repos em \`workspace/\`. Rode no começo do trabalho.
- \`hubspec hub status\`: mostra as docs desatualizadas. Rode depois de um merge e sugira atualizar as docs.
- \`hubspec hub document [repos]\`: gera ou atualiza as docs (siga a skill \`hubspec-document\`). Documenta a branch padrão de cada repo: rode \`hubspec hub sync\` antes.
- \`hubspec hub depends <repo> --add <outro> --via "<como>" --source llm\`: registra uma dependência entre repos encontrada no código.
- \`hubspec hub pr <change>\`: com as tasks de um repo concluídas, abre as PRs (uma por repo) com as irmãs e a ordem de merge, e grava os links nas tasks.
- \`hubspec hub add <url> --new --change <change>\`: depois que a automação criou o repo, registra, clona e conclui a task manual.
- \`hubspec verify <change>\` e \`hubspec archive <change>\`: verificação dos cenários e archive com portão.
${END}
`;

/** Writes hubspec's section into a file, keeping whatever else is in it. */
export function upsertSection(file: string, section: string): void {
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) {
    writeFileSync(file, section);
    return;
  }
  const text = readFileSync(file, "utf8");
  const s = text.indexOf(START);
  const e = text.indexOf(END);
  writeFileSync(file, s >= 0 && e > s ? text.slice(0, s) + section.trimEnd() + text.slice(e + END.length) : `${text.trimEnd()}\n\n${section}`);
}

/** The hub's commands: the same few lines for every agent, which run the CLI and read its result. */
export const COMMANDS: Record<string, { description: string; body: string }> = {
  sync: {
    description: "Clona ou atualiza os repositórios do hub em workspace/",
    body: "Rode `hubspec hub sync` na raiz do hub e resuma o resultado por repo: clonado, atualizado, em dia ou pulado (com o motivo).\n\nUm repo pulado por mudanças locais ou por estar em outra branch fica como está: não descarte nada e pergunte ao usuário o que fazer.",
  },
  status: {
    description: "Mostra os repos com a documentação desatualizada",
    body: "Rode `hubspec hub status` na raiz do hub e mostre os repos por estado.\n\nPara os repos com doc desatualizada ou sem doc, sugira atualizar com o comando de documentação do hub (`hubspec hub document <repos>`, pela skill hubspec-document).",
  },
  document: {
    description: "Gera ou atualiza a documentação dos repositórios do hub",
    body: "Siga a skill **hubspec-document** para estes repos (todos os ativos, se nenhum for dado): {{ARGS}}",
  },
  pr: {
    description: "Abre as PRs de uma change do hub, uma por repo, na ordem de merge",
    body: "Change: {{ARGS}}\n\n1. Rode `hubspec hub pr <change> --dry-run` e mostre o plano: quais repos terão PR e quais ficam de fora (com tasks em aberto).\n2. Peça confirmação ao usuário: o comando faz commit do que estiver pendente na branch da change, push e abre as PRs pelo gh.\n3. Com a confirmação, rode `hubspec hub pr <change>` e mostre os links e a ordem de merge.",
  },
  add: {
    description: "Registra um repositório no hub",
    body: "Argumentos: {{ARGS}}\n\nRode `hubspec hub add <url>` com as opções dadas (`--description`, `--tags`, `--depends`). Para um repo que a automação da organização acabou de criar para uma change, use `--new --change <change>`: ele clona o repo, vincula à change e conclui a task manual.\n\nDepois, sugira documentar o repo novo com `hubspec hub document <repo>`.",
  },
};

/** The tools that get the hub's commands, AGENTS.md pointers and playbooks. */
export const ADAPTER_TOOLS = ["claude", "devin", "github-copilot", "opencode"] as const;
export type Tool = (typeof ADAPTER_TOOLS)[number];

/** Where each tool reads custom commands, and how a command file looks there. */
const ADAPTERS: Record<Tool, { path: (cmd: string) => string; args: string; render: (description: string, body: string) => string }> = {
  claude: {
    path: (cmd) => `.claude/commands/hub/${cmd}.md`,
    args: "$ARGUMENTS",
    render: (d, b) => `---\ndescription: ${d}\nargument-hint: "[argumentos]"\n---\n\n${b}\n`,
  },
  opencode: {
    path: (cmd) => `.opencode/commands/hub-${cmd}.md`,
    args: "$ARGUMENTS",
    render: (d, b) => `---\ndescription: ${d}\n---\n\n${b}\n`,
  },
  "github-copilot": {
    path: (cmd) => `.github/prompts/hub-${cmd}.prompt.md`,
    args: "${input:args}",
    render: (d, b) => `---\ndescription: ${d}\nmode: agent\n---\n\n${b}\n`,
  },
  devin: {
    path: (cmd) => `.devin/workflows/hub-${cmd}.md`,
    args: "os argumentos que o usuário deu",
    render: (d, b) => `---\ndescription: ${d}\n---\n\nAntes, leia o AGENTS.md na raiz do hub.\n\n${b}\n`,
  },
};

export function renderCommand(tool: Tool, cmd: string): { path: string; text: string } {
  const a = ADAPTERS[tool];
  const c = COMMANDS[cmd]!;
  return { path: a.path(cmd), text: a.render(c.description, c.body.replaceAll("{{ARGS}}", a.args)) };
}

/**
 * A Devin playbook for a hub command (spec 8: "playbooks/knowledge apontando para o
 * AGENTS.md"), in the sections Devin's playbooks use. Devin reads these from the web app:
 * the files are written to be imported there.
 */
export function renderPlaybook(cmd: string): string {
  const c = COMMANDS[cmd]!;
  return [
    `# hub ${cmd}: ${c.description}`,
    "",
    "## Overview",
    "",
    `${c.description}, num hub multi-repo do hubspec. As regras do hub estão no AGENTS.md da raiz do hub.`,
    "",
    "## What's Needed From User",
    "",
    cmd === "pr" ? "- O nome da change." : cmd === "add" ? "- A URL do repo (ou dono/repo) e, para um repo novo, a change." : cmd === "document" ? "- Os repos a documentar (todos os ativos, se nenhum)." : "- Nada.",
    "",
    "## Procedure",
    "",
    "1. Leia o AGENTS.md na raiz do hub.",
    `2. ${c.body.replaceAll("{{ARGS}}", "os argumentos que o usuário deu").replace(/\n+/g, " ")}`,
    "",
    "## Forbidden Actions",
    "",
    "- Não descarte mudanças locais dos clones em workspace/.",
    "- Não crie repositórios: repos novos vêm da automação da organização.",
    "- Não faça commit no hub sem o usuário pedir.",
    "",
  ].join("\n");
}

const DEVIN_KNOWLEDGE = `# Hub multi-repo (hubspec)

**Quando usar:** ao trabalhar num repositório que tem \`repos.yaml\` e \`AGENTS.md\` na raiz (um hub do hubspec).

Este repositório guarda o mapa do sistema; o código fica em \`workspace/<repo>/\`. Antes de responder ou propor, leia o AGENTS.md da raiz e siga as quatro seções dele: o que é o hub, como se orientar (system-overview, depois as docs dos repos, código só se preciso), as regras para changes (tasks com [repo] e componente, ordem de dependência, task [manual] que bloqueia, template que não se recria) e os comandos (\`hubspec hub sync | status | document | pr\`).
`;

/**
 * The thin per-agent layer (spec 8): AGENTS.md as the common entry point (imported by
 * CLAUDE.md, pointed to by Copilot's instructions and Devin's knowledge), the hub's commands
 * for each tool, Devin's playbooks, and the hub's rules in openspec/config.yaml, which the
 * standard /opsx workflows hand to every agent.
 */
export function writeAdapters(hub: string, tools: readonly Tool[]): string[] {
  const written: string[] = [];
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(hub, path)), { recursive: true });
    writeFileSync(join(hub, path), text);
    written.push(path);
  };
  upsertSection(join(hub, "AGENTS.md"), AGENTS_SECTION);
  written.push("AGENTS.md");
  if (existsSync(join(hub, "openspec"))) {
    writeHubConfig(hub);
    written.push("openspec/config.yaml");
  }
  for (const tool of tools) for (const cmd of Object.keys(COMMANDS)) {
    const { path, text } = renderCommand(tool, cmd);
    write(path, text);
  }
  if (tools.includes("claude")) {
    // Claude Code reads CLAUDE.md, not AGENTS.md: the import makes AGENTS.md its entry point too.
    upsertSection(join(hub, "CLAUDE.md"), `${START}\n@AGENTS.md\n${END}\n`);
    written.push("CLAUDE.md");
  }
  if (tools.includes("github-copilot")) {
    upsertSection(join(hub, ".github", "copilot-instructions.md"), `${START}\nEste repositório é o hub do sistema. Antes de responder ou propor mudanças, siga o [AGENTS.md](../AGENTS.md) da raiz.\n${END}\n`);
    written.push(".github/copilot-instructions.md");
  }
  if (tools.includes("devin")) {
    for (const cmd of Object.keys(COMMANDS)) write(`.devin/playbooks/hub-${cmd}.devin.md`, renderPlaybook(cmd));
    write(".devin/knowledge/hub.md", DEVIN_KNOWLEDGE);
  }
  return written;
}
