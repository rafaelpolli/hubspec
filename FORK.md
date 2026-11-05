# O OpenSpec dentro do hubspec

O hubspec traz o código do [OpenSpec](https://github.com/Fission-AI/OpenSpec) (MIT, licença em `src/openspec/LICENSE`) e é distribuído sem depender do pacote `@fission-ai/openspec`.

| | |
|---|---|
| Versão de origem | 1.16.0, tag `v1.16.0`, commit `27c0515` (ver `src/openspec/UPSTREAM.json`) |
| Onde está | `src/openspec/` (o `src/` do OpenSpec) e `schemas/` |
| Conferência na importação | compilado com `tsc`, o `src/openspec/` sem patches gera os mesmos 216 arquivos `.js` do pacote `@fission-ai/openspec@1.16.0` do npm |
| Fora | os testes do OpenSpec (~90 mil linhas, em vitest), a documentação, o site e os scripts de release |

## Como chega aqui

`bun scripts/import-openspec.ts <checkout do OpenSpec> [destino]` substitui `src/openspec/` e `schemas/` do destino (por padrão, este repositório) pela versão do checkout e faz as trocas mecânicas abaixo. Os patches da próxima seção são feitos à mão por cima.

Trocas mecânicas (em todos os arquivos):

- `openspec <comando>` vira `hubspec <comando>` quando `<comando>` é um comando do CLI, ou uma opção (`--x`, `-x`). Isso cobre as mensagens e o texto das skills e comandos `/opsx` que o `init` gera. Ficam como estão: os caminhos `openspec/`, os nomes `openspec-*` das skills, os comandos `/opsx:*`, as variáveis `OPENSPEC_*` e "OpenSpec" na prosa;
- `Bash(openspec:*)` vira `Bash(hubspec:*)`, `Requires openspec CLI.` vira `Requires hubspec CLI.`, `npm install -g @fission-ai/openspec` vira `npm install -g hubspec` e "the `openspec` CLI" vira "the `hubspec` CLI";
- nas completions de shell (`core/completions/`, `commands/completion.ts`): o nome do comando, das funções e dos marcadores de bloco nos arquivos do shell.

## Patches do hubspec

O que foi acrescentado ou trocado está marcado no código com `hubspec:` (ou "(hubspec)" no texto das skills); o que foi removido está listado aqui.

| Arquivo | O que muda |
|---|---|
| `cli/index.ts` | nome `hubspec`; sem telemetria (os hooks só tratam `--no-color` e a dica de completions); sem os comandos `install` (o instalador do binário do OpenSpec) e `feedback` (abre issues no repositório do OpenSpec); `archive --no-gate`; `init` e `update` instalam as skills do hubspec; sem a execução automática no fim do módulo (o ponto de entrada é `src/cli.ts`) |
| `core/archive.ts` | o portão da verificação (`src/verify.ts`) antes de arquivar, com o código `archive_gate_closed` no `--json` |
| `core/templates/workflows/archive-change.ts`, `bulk-archive-change.ts` | as skills `/opsx:archive` e `/opsx:bulk-archive` rodam `hubspec gate` antes de mover a change, porque movem a pasta sem passar pelo CLI |
| `core/init.ts`, `core/update.ts` | a versão vem do `package.json` do hubspec (`src/package.ts`); o `init` não aponta para o rastreador de issues do OpenSpec |
| `core/version-check.ts` | nunca consulta o npm (o pacote que o OpenSpec procura não é este); `version` mostra o hubspec e o OpenSpec de origem; a pasta de instalação vem de `packageRoot()` |
| `core/artifact-graph/resolver.ts` | `schemas/` fica em `packageRoot()`, onde quer que o empacotamento coloque o módulo |
| `core/global-config.ts` | config e dados globais em `hubspec/` (`~/.config/hubspec/`, `~/.local/share/hubspec/`), separados de um OpenSpec instalado ao lado |
| `core/completions/command-registry.ts` | sem `install` e `feedback`; `archive --no-gate`; os comandos do hubspec (`src/completions.ts`) |
| `core/templates/skill-templates.ts` | sem o template da skill de feedback |
| `utils/executable-path.ts` | procura `hubspec` no PATH |

Removidos: `telemetry/` (PostHog), `commands/feedback.ts`, `commands/install-standalone.ts`, `core/standalone-tip.ts` e `core/templates/workflows/feedback.ts`.

Do lado do hubspec, fora de `src/openspec/`: `src/package.ts` (nome, versão e raiz do pacote), `src/cli.ts` (ponto de entrada: o programa do OpenSpec mais `src/commands.ts`), `src/setup.ts` (as skills do hubspec no `init`/`update`), `src/binary.ts` (o binário standalone, como o `scripts/binary/entry.mjs` do OpenSpec) e `scripts/build.ts`.

## Trazer uma versão nova do OpenSpec

O branch `openspec-upstream` guarda só a importação pura: `src/openspec/` e `schemas/` como o `import-openspec.ts` os deixa, sem patches. O primeiro commit do repositório é a importação do 1.16.0, e o `main` parte dele. Para trazer uma versão nova, importe-a nesse branch e faça o merge dele no `main`. Assim, os conflitos aparecem só onde há patch.

O script roda a partir do `main`, e uma worktree do `openspec-upstream` recebe a importação:

```sh
git clone https://github.com/Fission-AI/OpenSpec ../OpenSpec      # uma vez
git -C ../OpenSpec fetch --tags && git -C ../OpenSpec checkout vX.Y.Z

git worktree add ../hubspec-upstream openspec-upstream
bun scripts/import-openspec.ts ../OpenSpec ../hubspec-upstream
git -C ../hubspec-upstream add -A src/openspec schemas
git -C ../hubspec-upstream commit -m "OpenSpec X.Y.Z"
git worktree remove ../hubspec-upstream

git merge openspec-upstream          # no main
bun run typecheck && bun run test
```

Depois do merge, confira se a versão nova trouxe comandos que mandam dados para fora (telemetria, checagem de versão, feedback) ou que instalam o OpenSpec, e se as skills que movem arquivos sem o CLI continuam passando pelo `hubspec gate`.
