# Verificação e portão

A verificação responde a uma pergunta: cada cenário da change tem um teste, e esse teste passa? O agente aponta os testes, e o CLI confere tudo sozinho, sem confiar no agente:

- se o teste existe onde o agente disse;
- se o teste passa;
- se faltou alguma task;
- se algo mudou depois da verificação.

## Os arquivos

Todos ficam dentro da change e vão junto para o archive ([a pasta de uma change](primeiros-passos.md#a-pasta-de-uma-change)):

| Arquivo | Quem escreve | O que é |
|---|---|---|
| `.hubspec/trace.json` | o agente (ou você) | qual teste exercita cada cenário |
| `.hubspec/verification.json` | `hubspec verify` | o resultado de cada item e o retrato do código e dos artefatos verificados |
| `verification.md` | `hubspec verify`, `check` e `justify` | o relatório para ler. É gerado: não edite à mão |

## Os cenários

`hubspec scenarios <change>` lista os `#### Scenario:` dos requisitos nas seções `ADDED` e `MODIFIED` das delta specs. O id de cada cenário é `<capability>/<requisito>/<cenário>`, como `soma/Soma/Soma simples`. Com `--json`, sai em JSON.

## O trace

`hubspec scenarios <change> --template` cria o `.hubspec/trace.json`, com um item por cenário, para preencher:

```json
{
  "items": [
    { "id": "soma/Soma/Soma simples", "kind": "teste", "file": "calc.test.ts", "line": 4, "name": "soma 2 + 3" },
    { "id": "soma/Soma/Resultado em destaque", "kind": "manual", "note": "visual, conferir na tela" },
    { "id": "soma/Soma/Números negativos", "kind": "sem-teste", "note": "falta o teste" }
  ]
}
```

| Campo | O que vai nele |
|---|---|
| `id` | o id do cenário, sem mudar |
| `kind` | `teste` (um teste exercita o cenário), `manual` (não dá para automatizar, como algo visual) ou `sem-teste` (dá para automatizar, mas nenhum teste o exercita) |
| `file` | o arquivo do teste, relativo à raiz do projeto. Num hub, relativo a `workspace/<repo>/` |
| `line` | a linha onde o teste é declarado |
| `name` | o nome do teste como está no código, sem os nomes dos `describe` |
| `repo` | só num hub: o repo onde o teste está |
| `note` | opcional |

Os itens `manual` e `sem-teste` não levam `file`, `line` nem `name`. Um cenário que não aparece no trace conta como `sem-teste`.

## O que o `hubspec verify` faz

Para cada item do trace, em ordem:

1. **Confere a evidência**: o arquivo precisa estar no projeto, e o nome do teste precisa aparecer na linha indicada ou até 5 linhas depois. Se não aparecer, o item fica como **evidência inválida** e o teste nem roda.
2. **Roda o teste sozinho**, pelo nome, com o runner do projeto:

   | Runner | Quando | Comando |
   |---|---|---|
   | pytest | arquivo `.py` num projeto com `pyproject.toml`, `pytest.ini`, `conftest.py`, `setup.cfg` ou `tox.ini` | `python3 -m pytest <arquivo>::<nome>` |
   | vitest | `vitest` nas dependências do `package.json` | `vitest run <arquivo> -t <nome>` |
   | jest | `jest` nas dependências do `package.json` | `jest <arquivo> -t <nome>` |
   | bun | script `test` começando com `bun test`, ou um `bun.lock` | `bun test ./<arquivo> -t <nome>` |

   O vitest e o jest rodam por `bunx`, `pnpm exec`, `yarn` ou `npx`, conforme o lockfile do projeto. Com um runner desconhecido, o item fica como **não executado**.

   Cada teste tem 5 minutos para terminar; `--timeout <segundos>` muda esse limite.
3. **Confere as tasks**: as tasks ainda abertas no `tasks.md` viram um item a mais, **tasks pendentes**.
4. **Escreve** o `verification.json` e o `verification.md`.

O código de saída é **0 para PASS**, **2 para CONCERNS** e **1 para FAIL**. Com `--json`, o resultado sai em JSON.

## O veredito

| Veredito | Quando |
|---|---|
| **FAIL** | algum teste falhou |
| **CONCERNS** | nenhum teste falhou, mas resta pelo menos um destes: item manual não conferido, sem teste, evidência inválida, não executado, prova fraca, tasks pendentes |
| **PASS** | todos os itens passaram ou foram conferidos |

O resumo numera os itens (`#1`, `#2`…). Cada item em CONCERNS pede uma ação sua:

| Item | O que fazer |
|---|---|
| manual | conferir à mão e registrar como conferiu: `hubspec check <change> <n> --note "<o que você conferiu>"` |
| sem teste, evidência inválida, não executado | escrever ou corrigir o teste e verificar de novo, ou aceitar e justificar: `hubspec justify <change> <n> "<motivo>"` |
| prova fraca | melhorar o teste, ou justificar |
| tasks pendentes | terminar as tasks e verificar de novo, ou justificar |

O `check` e o `justify` refazem o veredito e o relatório sem rodar os testes de novo. As skills nunca rodam esses dois comandos por conta própria: o texto vem sempre de você.

## A prova vermelho → verde

Um teste que passa não prova que a change fez diferença: ele podia já passar antes. Com `--prove`, cada teste que passou roda também em duas cópias temporárias do projeto. A primeira tem o código de agora e serve de controle. A segunda tem o código de antes da change, com os testes de agora. O resultado é uma de três notas:

- **forte**: o teste falhava antes e passa agora;
- **fraca**: o teste já passava antes. A nota deixa o veredito em CONCERNS;
- **inconclusiva**: o teste não passou nem na cópia de controle, por exemplo porque depende de algo fora do projeto, então a comparação não vale.

O padrão de `--prove` é o `HEAD`, que serve quando a change ainda não foi commitada. Se já foi, informe o commit de antes dela, por exemplo `--prove main` ou `--prove HEAD~1`. A prova precisa de Git, e o projeto em si nunca é tocado.

## Desatualização

O `verification.json` guarda um retrato do código e dos artefatos da change no momento da verificação. O código conta sem `openspec/` e sem o que está no `.gitignore`, e as mudanças ainda não commitadas também entram no retrato. Se o código ou os artefatos mudarem depois disso, a verificação fica desatualizada e o portão fecha até você verificar de novo.

Num hub, o retrato cobre todos os repos clonados em `workspace/`. As docs do próprio hub não contam.

## O portão

```
hubspec gate <change>          # saída 0 = liberado, 1 = fechado
hubspec gate <change> --json
```

O portão está liberado quando a verificação mais recente:

- está em dia, isto é, nada mudou depois dela;
- deu PASS, ou deu CONCERNS com todos os itens conferidos (`check`) ou justificados (`justify`).

Quando está fechado, o comando diz o motivo, e no `--json` lista os itens que faltam:

```json
{
  "allowed": false,
  "reason": "justifique os itens que deixam o veredito em CONCERNS (#2) com `hubspec justify add-soma <n> \"<motivo>\"`",
  "verdict": "CONCERNS",
  "missing": [2]
}
```

Para um item manual como esse, `hubspec check` também resolve.

## O archive passa pelo portão

- **`hubspec archive <change>`** confere o portão antes de arquivar e recusa se ele estiver fechado. No `--json`, a recusa sai com o código `archive_gate_closed`.
- **A skill `/opsx:archive`** padrão move a pasta da change sem passar pelo CLI. Por isso, no hubspec, ela roda `hubspec gate` antes, e o mesmo vale para a `/opsx:bulk-archive`.
- **A skill `hubspec-archive`** faz o mesmo e, com o portão fechado, diz o que falta.

`hubspec archive <change> --no-gate` arquiva sem verificação. As skills só usam essa opção quando você pede explicitamente.
