# Referência dos comandos

`hubspec --help` lista todos os comandos, e `hubspec <comando> --help` mostra as opções de cada um. Os comandos do hubspec têm a ajuda em português. Os que vêm do OpenSpec continuam em inglês, como no original.

## Projeto

| Comando | O que faz |
|---|---|
| `hubspec init [path] [--tools <ids>\|all\|none] [--language <idioma>]` | cria `openspec/`, as skills e comandos `/opsx` padrão e as skills `hubspec-*` para cada ferramenta. Num projeto que já tem `openspec/`, acrescenta ferramentas. Num hub, escreve também os adaptadores dos agentes |
| `hubspec update [path]` | regenera as skills e os comandos padrão e repõe as skills `hubspec-*` |
| `hubspec config list\|get\|set\|unset\|reset\|edit\|path` | a config global, em `~/.config/hubspec/config.json` |
| `hubspec config profile [preset]` | escolhe os workflows instalados. O perfil `core` traz propose, explore, apply, archive, sync e update. Ainda há new, continue, ff, bulk-archive, verify e onboard |
| `hubspec completion install\|uninstall\|generate [shell]` | completions para bash, zsh, fish e PowerShell |
| `hubspec version` | a versão do hubspec e a do OpenSpec que vem dentro dele |

## Changes e specs (do OpenSpec)

| Comando | O que faz |
|---|---|
| `hubspec new change <nome> [--description <texto>] [--schema <nome>]` | cria `openspec/changes/<nome>/` |
| `hubspec list [--specs] [--archived\|--all] [--json]` | as changes ativas, ou as specs |
| `hubspec show [item] [--json] [--diff]` | mostra uma change ou uma spec |
| `hubspec status [--change <nome>] [--json]` | quais artefatos da change estão prontos e qual é o próximo |
| `hubspec instructions [artefato] --change <nome> [--json]` | as instruções para escrever um artefato (proposal, specs, design, tasks), ou para o apply e o archive. É o que as skills `/opsx` consultam |
| `hubspec validate [item] [--all\|--changes\|--specs] [--strict] [--json]` | valida a estrutura das changes e das specs |
| `hubspec archive [change] [-y] [--skip-specs] [--no-gate] [--json]` | mescla as delta specs nas specs principais e move a change para `archive/`, **atrás do portão** da verificação |
| `hubspec view` | painel interativo das specs e changes |
| `hubspec change show\|validate`, `hubspec spec show\|list\|validate` | as mesmas consultas, por tipo |
| `hubspec schemas`, `hubspec templates`, `hubspec schema which\|validate\|fork\|init` | os schemas de workflow e os templates dos artefatos |
| `hubspec store …`, `hubspec workset …`, `hubspec doctor`, `hubspec context` | recursos do OpenSpec para guardar as specs num repositório próprio e para montar visões de trabalho com várias pastas |

## Verificação

| Comando | Saída | O que faz |
|---|---|---|
| `hubspec scenarios <change> [--json\|--template]` | 0 | lista os cenários das delta specs; `--template` cria o `.hubspec/trace.json` |
| `hubspec verify <change> [--prove [commit]] [--timeout <s>] [--json]` | 0 PASS, 2 CONCERNS, 1 FAIL | confere o trace, roda os testes e escreve o `verification.md` |
| `hubspec check <change> <n> [--note <texto>]` | 0 | confirma o item manual `#n` e mostra o veredito novo |
| `hubspec justify <change> <n> <texto…>` | 0 | justifica o item `#n` que deixa a verificação em CONCERNS e mostra o veredito novo |
| `hubspec gate <change> [--json]` | 0 liberado, 1 fechado | o portão do archive |

O guia [Verificação e portão](verificacao.md) explica cada um em detalhe.

## Hub multi-repo

Todos rodam na raiz do hub. `hubspec hub help` mostra o resumo.

| Comando | O que faz |
|---|---|
| `hubspec hub init [--repos <url\|dono/repo…>] [--repos-file <arquivo>] [--branch <b>] [--tools <ids>\|all]` | cria o hub. `--branch` é a branch de trabalho do hub (num Git Flow, `develop`); rodado num hub que já existe, passa os repos para ela. As ferramentas padrão são claude, devin, github-copilot e opencode |
| `hubspec hub add <url\|dono/repo> [--name] [--branch] [--description] [--tags a,b] [--depends a,b]` | registra um repo |
| `hubspec hub add <url> --new --change <change>` | registra o repo que a automação criou para uma change e conclui a task `[manual]` |
| `hubspec hub sync` | clona e atualiza os repos em `workspace/`; volta da branch da change quando nada se perde |
| `hubspec hub document [repos…]` | varredura determinística e templates das docs |
| `hubspec hub document --done [repos…]` | registra o commit documentado; recusa se faltar preencher alguma seção |
| `hubspec hub depends <repo> [--set\|--add\|--remove a,b] [--via <texto>] [--source llm\|manual]` | as dependências entre repos; regenera o mapa |
| `hubspec hub status` | docs desatualizadas em relação à branch padrão no remote; saída 1 se houver |
| `hubspec hub pr <change> [--dry-run]` | uma PR por repo, com as PRs irmãs e a ordem de merge |
| `hubspec hub archive <repo>` | aposenta o repo |
| `hubspec hub remove <repo> [--yes] [--force]` | tira o repo do manifesto e apaga as docs e o clone |

O guia [Hub multi-repo](hub.md) mostra o passo a passo.

## Saída em JSON

Os comandos com `--json` servem para scripts e agentes. Os erros do `archive --json` trazem um código. A recusa do portão, por exemplo, vem com `archive_gate_closed`.
