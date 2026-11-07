# Problemas comuns

## Instalação

**`hubspec: command not found`**
A pasta onde você pôs o link ou o binário não está no `PATH`. Com `~/.local/bin`, acrescente `export PATH="$HOME/.local/bin:$PATH"` ao `~/.bashrc` ou ao `~/.zshrc` e abra um terminal novo.

**Erro de sintaxe ou de módulo ao rodar o `hubspec`**
O CLI em Node precisa do Node 22.12 ou mais novo (`node --version`). Se não der para atualizar o Node, use o [binário standalone](instalacao.md#binário-standalone-sem-node).

**O agente diz que o `hubspec` não existe**
O agente roda os comandos no mesmo `PATH` que o terminal dele. Instale o CLI ([Instalar](instalacao.md)) e reinicie o agente ou o editor.

## Skills e agentes

**As skills ou os comandos `/opsx` não aparecem**
Reabra o projeto no editor ou reinicie o agente: a maioria das ferramentas só lê essas pastas ao iniciar. Confira se as pastas da ferramenta existem (por exemplo `.claude/skills/hubspec-verify/`). Se não existirem, rode `hubspec init --tools <id da ferramenta>`.

**O agente rodou `openspec …` em vez de `hubspec …`**
As skills `/opsx` do projeto foram geradas pelo OpenSpec, não pelo hubspec. Isso acontece, por exemplo, depois de um `openspec update`. Rode `hubspec update`.

**O agente arquivou sem verificar**
Confira se a skill `openspec-archive-change` do projeto tem o passo "verification gate (hubspec)". Se não tiver, ela é a do OpenSpec original: rode `hubspec update`.

**`hubspec init --copilot-cloud`**
O OpenSpec gera para o agente do Copilot na nuvem um passo `npm install -g hubspec`. Esse comando ainda não funciona, porque o hubspec não está publicado no npm ([Instalar](instalacao.md)). Até ele ser publicado, não use essa opção.

## Verificação

**`nenhuma pasta openspec/ encontrada a partir daqui: rode hubspec init na raiz do projeto`**
Rode o comando dentro do projeto, ou rode `hubspec init` antes.

**`falta .hubspec/trace.json na change`**
Rode `hubspec scenarios <change> --template` e preencha um item por cenário ([o trace](verificacao.md#o-trace)).

**`.hubspec/trace.json não segue o formato …`**
O arquivo precisa ser `{ "items": [ … ] }`, e cada item precisa ter `id` e `kind` (`teste`, `manual` ou `sem-teste`). Os itens `teste` precisam também de `file`, `line` e `name`.

**Evidência inválida**

| Motivo | O que fazer |
|---|---|
| `o nome do teste não aparece perto da linha N` | `line` precisa ser a linha da declaração do teste, e `name` precisa ser o nome exato, sem os `describe` |
| `<arquivo> não existe no projeto` | o caminho é relativo à raiz do projeto (num hub, à raiz do clone do repo) |
| `<arquivo> está fora do projeto` | o teste precisa estar dentro do projeto |

**`runner desconhecido: confira este cenário manualmente`**
O hubspec não reconheceu o runner de testes do projeto. Os suportados e como cada um é detectado estão em [O que o `hubspec verify` faz](verificacao.md#o-que-o-hubspec-verify-faz). Com outro runner, marque o cenário como `manual` e confira com `hubspec check`.

**`o teste passou do tempo limite`**
Cada teste tem 5 minutos. Aumente com `hubspec verify <change> --timeout 900`.

**`o código não mudou desde HEAD: use --prove <commit de antes da change>`**
A change já foi commitada, então o `HEAD` não serve de "antes". Informe o commit de antes dela: `--prove main`, `--prove HEAD~1` ou o hash.

**`a prova vermelho → verde precisa de um repositório Git`**
A prova compara com um commit. Sem Git, rode o `verify` sem `--prove`.

## Portão e archive

**`Portão fechado: o código ou os artefatos mudaram depois da verificação`**
Algo mudou depois do último `verify`, no código ou na change. Rode `hubspec verify <change>` de novo.

**`Portão fechado: há testes falhando`**
Corrija o código (pelo `/opsx:apply`) e verifique de novo.

**`Portão fechado: justifique os itens que deixam o veredito em CONCERNS (#n)`**
Os itens manuais se resolvem com `hubspec check <change> <n> --note "…"`, e os demais com `hubspec justify <change> <n> "…"`. A outra saída é resolver o problema e verificar de novo.

**Preciso arquivar uma change sem testes**
Por exemplo, uma change só de documentação. Use `hubspec archive <change> --no-gate`. Para pedir isso ao agente, diga explicitamente "arquive sem verificação".

## Hub

**`hub pr` recusa por causa de uma task `[manual]`**
Uma task manual ainda está aberta, por exemplo a criação de um repo. Crie o repo e rode `hubspec hub add <url> --new --change <change>`, que conclui a task.

**`hub sync`: `o remote não tem a branch develop`**
O repo segue a branch de trabalho do hub, e o remote dele não tem essa branch. Crie a branch no remote, ou informe a branch em que o repo trabalha: `hubspec hub add <url> --branch main`.

**`hub document` recusa um clone**
As docs descrevem a branch de trabalho em dia. Rode `hubspec hub sync`. Se o clone tiver trabalho local na branch da change, envie esse trabalho (pelo `hub pr`) ou descarte-o antes.

**`hub document --done` recusa**
Ainda há uma seção com `<!-- hubspec:preencher -->` nas docs de algum repo ou no `system-overview.md`. Preencha a seção, ou escreva "Não se aplica" e o motivo.

**Erros do `gh` no `hub pr`**
Rode `gh auth status`. Se não estiver autenticado, rode `gh auth login`.
