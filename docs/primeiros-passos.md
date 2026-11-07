# Primeiros passos

Este guia leva um projeto do zero até a primeira change arquivada. O exemplo é uma calculadora em TypeScript com testes no Bun e a função `soma` errada. As saídas abaixo são reais, da versão 0.4.0; algumas foram encurtadas.

Antes de começar, você precisa de:

- o `hubspec` no PATH ([Instalar](instalacao.md));
- um projeto com Git;
- testes num destes runners: bun, vitest, jest ou pytest. Sem testes, a verificação ainda funciona, mas cada cenário fica como manual ou sem teste.

## 1. Preparar o projeto

Na raiz do projeto:

```sh
hubspec init --tools claude
```

Use os ids das ferramentas que você usa, separados por vírgula (por exemplo `claude,github-copilot,opencode,devin,cursor`), ou `all`. Sem `--tools`, o `init` pergunta. A lista completa está em `hubspec init --help`.

Para os artefatos (proposal, specs, design, tasks) saírem em português, acrescente `--language pt-BR`.

O `init` cria:

```
openspec/
  config.yaml            # schema, contexto do projeto e regras por artefato
  specs/                 # as specs vigentes
  changes/               # as changes em andamento; archive/ guarda as concluídas
.claude/
  commands/opsx/         # /opsx:propose, /opsx:apply, /opsx:archive, /opsx:explore, /opsx:sync, /opsx:update
  skills/openspec-*/     # as skills padrão do OpenSpec
  skills/hubspec-*/      # as skills do hubspec
```

### As pastas de cada ferramenta

Cada ferramenta tem as suas pastas, com as mesmas skills e os mesmos comandos:

| Ferramenta | Skills | Comandos `/opsx` |
|---|---|---|
| Claude Code | `.claude/skills/` | `.claude/commands/opsx/*.md` |
| GitHub Copilot | `.github/skills/` | `.github/prompts/opsx-*.prompt.md` |
| OpenCode | `.opencode/skills/` | `.opencode/commands/opsx-*.md` |
| Devin | `.devin/skills/` | `.devin/workflows/opsx-*.md` |

- **Em cada pasta de skills** ficam as seis `openspec-*` e as seis `hubspec-*`, inclusive a `hubspec-hub` e a `hubspec-document`, que só servem num hub.
- **As outras ferramentas que o OpenSpec suporta**, como o Cursor, seguem o padrão do OpenSpec, cada uma na sua pasta.
- **Num hub**, o `hub init` acrescenta os comandos do hub e as instruções que apontam para o `AGENTS.md` ([Os agentes no hub](hub.md#os-agentes-no-hub)).

Faça commit desses arquivos, para quem clonar o projeto ter o mesmo fluxo.

Outros casos:

- Para acrescentar uma ferramenta depois, rode o `init` de novo só com ela, por exemplo `hubspec init --tools cursor`.
- Depois de atualizar o hubspec, rode `hubspec update` para receber as skills novas.
- Abra o projeto de novo no editor (ou reinicie o agente) para ele ver as skills e os comandos.

## 2. O fluxo

```
 explorar ──► decidir ──► propor ──► implementar ──► verificar ──► arquivar
 (opcional)
 hubspec-     hubspec-    /opsx:     /opsx:apply     hubspec-      hubspec-archive
 explore      decide      propose                    verify        ou /opsx:archive
```

| Etapa | O que acontece | O que fica na change |
|---|---|---|
| **Explorar** | conversa de várias rodadas, só de leitura. Quando você pede "virar change", o agente mostra um rascunho com nome, descrição e decisões, e espera você aprovar | `exploration.md` |
| **Decidir** | o agente levanta as decisões que só você pode tomar (escopo, comportamento visível, compatibilidade, critérios de aceite) e pergunta | `decisions.md` |
| **Propor** | o propose padrão do OpenSpec escreve os artefatos, tratando as decisões como requisitos | `proposal.md`, `specs/`, `design.md`, `tasks.md` |
| **Implementar** | o apply padrão implementa as tasks e marca cada uma como concluída | o código e os testes |
| **Verificar** | o agente aponta um teste por cenário; o CLI confere, roda os testes e dá o veredito | `.hubspec/trace.json`, `verification.md` |
| **Arquivar** | com o portão liberado, as delta specs vão para `openspec/specs/` e a change vai para `openspec/changes/archive/` | a change inteira, arquivada |

Os passos de explorar e decidir são opcionais. O `/opsx:propose` padrão funciona sozinho, mas aí o agente decide por conta própria o que não estiver no seu pedido.

### A pasta de uma change

Cada change é uma pasta em `openspec/changes/`. Com todas as etapas feitas, ela fica assim:

```
openspec/changes/add-soma/
  .openspec.yaml              # o schema e a data de criação (new change)
  README.md                   # o nome e a descrição (new change --description)
  exploration.md              # a exploração que virou change (hubspec-explore)
  decisions.md                # as decisões e as respostas (hubspec-decide)
  proposal.md                 # o porquê e o que muda (propose)
  design.md                   # como fazer (propose)
  specs/<capacidade>/spec.md  # as delta specs: requisitos e cenários (propose)
  tasks.md                    # as tasks (propose); o apply marca as concluídas
  .hubspec/
    trace.json                # qual teste cobre cada cenário (o agente, na verificação)
    verification.json         # o resultado e o retrato do código e dos artefatos (hubspec verify)
  verification.md             # o relatório PASS / CONCERNS / FAIL (hubspec verify)
```

- **Só existe o que já foi feito.** Uma change criada direto pelo `/opsx:propose`, por exemplo, não tem `exploration.md` nem `decisions.md`.
- **Ao arquivar**, a pasta inteira vai para `openspec/changes/archive/<data>-<nome>/`, e as delta specs entram em `openspec/specs/`.
- **Num hub**, as tasks do `tasks.md` começam com `[repo]` e, depois do `hub pr`, ganham os links das PRs.

## 3. Como chamar cada etapa no seu agente

As skills `hubspec-*` são acionadas pelo pedido: o agente lê a descrição de cada skill e escolhe a que serve. Você também pode citar a skill pelo nome.

| Ferramenta | Propor e implementar | Skills do hubspec |
|---|---|---|
| Claude Code | `/opsx:propose "ideia"`, `/opsx:apply` | `/hubspec-explore`, `/hubspec-decide`, `/hubspec-verify`, `/hubspec-archive`, ou um pedido |
| GitHub Copilot | `/opsx-propose "ideia"`, `/opsx-apply` | um pedido (por exemplo "use a skill hubspec-decide para…") |
| OpenCode, Cursor | `/opsx-propose "ideia"`, `/opsx-apply` | um pedido |
| Devin Desktop | `/openspec-propose "ideia"` | um pedido |

Pedidos que acionam cada skill:

- "quero explorar uma ideia: …" ou "vamos pensar em …" → **hubspec-explore**
- "vira change" → **hubspec-explore**, que cria a change e passa para a **hubspec-decide**
- "propor com decisões: …" → **hubspec-decide**, que termina chamando o propose
- "verificar a change add-soma" → **hubspec-verify**
- "arquivar a change add-soma" → **hubspec-archive**

## 4. O exemplo, do começo ao fim

O projeto tem `calc.ts` com o bug (`a - b`), `package.json` com `"test": "bun test"` e um commit.

### Explorar e decidir

> **Você:** quero explorar uma ideia: a calculadora precisa somar.
>
> **Agente:** (lê o código e as specs, pergunta, mostra opções…) Decidido: a soma aceita só dois números.
>
> **Você:** vira change.
>
> **Agente:** Rascunho: `add-soma`, "Somar dois números", decisões: quantos números → dois. Quer mudar algo?
>
> **Você:** pode criar.

O agente roda `hubspec new change add-soma --description "Somar dois números"` e escreve o `exploration.md`. Em seguida, a **hubspec-decide** pergunta o que ainda está em aberto. No Claude Code, as perguntas aparecem como opções clicáveis; nas outras ferramentas, como uma lista numerada que você responde assim: `1b, 2a`. A resposta "aceitar recomendações" responde todas com a opção recomendada.

As respostas vão para o `decisions.md`, e o propose escreve os artefatos. A delta spec fica assim:

```markdown
## ADDED Requirements

### Requirement: Soma
A calculadora SHALL somar dois números.

#### Scenario: Soma simples
- **WHEN** soma(2, 3)
- **THEN** o resultado é 5

#### Scenario: Resultado em destaque
- **WHEN** o usuário abre a tela
- **THEN** vê o resultado em destaque
```

Para ver onde a change está:

```
$ hubspec status --change add-soma
Change: add-soma
Schema: spec-driven
Progress: 3/4 artifacts complete

[x] proposal
[x] specs
[ ] design
[x] tasks
```

### Implementar

Com `/opsx:apply`, o agente implementa as tasks e escreve o teste:

```ts
// calc.test.ts
import { expect, test } from "bun:test";
import { soma } from "./calc.ts";

test("soma 2 + 3", () => {
  expect(soma(2, 3)).toBe(5);
});
```

### Verificar

A **hubspec-verify** lista os cenários e cria o trace:

```
$ hubspec scenarios add-soma
- soma/Soma/Soma simples
    - **WHEN** soma(2, 3)
    - **THEN** o resultado é 5
- soma/Soma/Resultado em destaque
    - **WHEN** o usuário abre a tela
    - **THEN** vê o resultado em destaque

$ hubspec scenarios add-soma --template
openspec/changes/add-soma/.hubspec/trace.json
```

O agente preenche o trace apontando o teste de cada cenário. O segundo cenário é visual, então fica manual:

```json
{
  "items": [
    { "id": "soma/Soma/Soma simples", "kind": "teste", "file": "calc.test.ts", "line": 4, "name": "soma 2 + 3" },
    { "id": "soma/Soma/Resultado em destaque", "kind": "manual", "note": "visual, conferir na tela" }
  ]
}
```

E roda a verificação. Como o bug continua lá, o veredito é FAIL:

```
$ hubspec verify add-soma
rodando: bun test ./calc.test.ts -t soma 2 \+ 3
Veredito: FAIL
  #1 FALHOU: Soma simples
  #2 manual: Resultado em destaque

Relatório: openspec/changes/add-soma/verification.md
```

O portão está fechado, então o archive recusa:

```
$ hubspec archive add-soma -y
✖ Error: Portão fechado para 'add-soma': há testes falhando: corrija e verifique de novo
Fix: hubspec verify add-soma
```

O agente mostra a falha e sugere corrigir pelo apply. Com `a + b` no lugar de `a - b`, verifique de novo. Com `--prove`, o hubspec confere também que o teste falhava antes da correção:

```
$ hubspec verify add-soma --prove
Veredito: CONCERNS
  #1 coberto, prova forte: Soma simples
  #2 manual: Resultado em destaque
```

O veredito agora é CONCERNS, por causa do item manual. Você confere a tela e conta ao agente o que viu; ele registra:

```
$ hubspec check add-soma 2 --note "conferi na tela: 5 em negrito"
Veredito: PASS
  #1 coberto, prova forte: Soma simples
  #2 manual (conferido): Resultado em destaque
```

O `verification.md` da change mostra o resultado:

```markdown
# Verificação: add-soma

- Veredito: **PASS**

| # | Cenário | Evidência | Resultado | Prova |
|---|---|---|---|---|
| 1 | Soma simples | `calc.test.ts:4` "soma 2 + 3" | coberto | forte |
| 2 | Resultado em destaque | - | manual (conferido) | - |

- **Resultado em destaque**: conferido — conferi na tela: 5 em negrito
```

### Arquivar

A **hubspec-archive** confere o portão, mostra o que vai acontecer e pede a sua confirmação:

```
$ hubspec gate add-soma
Portão liberado (PASS).

$ hubspec archive add-soma -y
Specs to update:
  soma: create
Applying changes to openspec/specs/soma/spec.md:
  + 1 added
Specs updated successfully.
Change 'add-soma' archived as '2026-11-05-add-soma'.
```

O requisito agora está em `openspec/specs/soma/spec.md`. A change, com `exploration.md`, `decisions.md`, `verification.md` e `.hubspec/`, fica em `openspec/changes/archive/2026-11-05-add-soma/`. O agente sugere um commit, mas só faz se você pedir.

## 5. Sem agente, só pelo CLI

As skills apenas organizam o trabalho do agente. Tudo o que elas fazem passa por comandos que você também pode rodar:

```sh
hubspec new change add-soma --description "Somar dois números"
hubspec instructions proposal --change add-soma   # o que escrever em cada artefato
hubspec status --change add-soma
hubspec validate add-soma
hubspec scenarios add-soma --template             # e preencher .hubspec/trace.json
hubspec verify add-soma
hubspec check add-soma 2 --note "…"               # ou: hubspec justify add-soma 2 "…"
hubspec gate add-soma
hubspec archive add-soma
```

Os detalhes da verificação estão em [Verificação e portão](verificacao.md). A lista de todos os comandos está na [referência](comandos.md).
