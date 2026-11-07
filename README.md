# hubspec

O OpenSpec num CLI só, sem dependências, com o fluxo do [OpenSpec Studio](https://github.com/rafaelpolli/openspec-studio) direto nos agentes de código: **Claude Code, Devin, GitHub Copilot, OpenCode** e as demais ferramentas que o OpenSpec suporta. O hubspec tem o OpenSpec dentro dele (ver [O OpenSpec dentro do hubspec](#o-openspec-dentro-do-hubspec)): `init`, `status`, `validate`, `archive`, as skills `/opsx` e o resto são comandos do próprio `hubspec`. As skills `hubspec-*` **complementam** as `/opsx` padrão, sem substituí-las. Para sistemas brownfield com vários repositórios, o [hub multi-repo](#hub-multi-repo) guarda o mapa do sistema, a documentação de cada repo e as changes que atravessam repos.

| Skill | Quando | O que faz |
|---|---|---|
| `hubspec-explore` | antes de existir a change | conversa de várias rodadas, só de leitura; quando você pede "virar change", o agente mostra um rascunho (nome, descrição e decisões) para você revisar, e só então cria a change e o `exploration.md` |
| `hubspec-decide` | antes do proposal | levanta as decisões que só você pode tomar, pergunta, grava `decisions.md` e então chama o propose padrão com as respostas como requisito |
| `hubspec-verify` | depois do apply | o agente aponta um teste por cenário (`.hubspec/trace.json`); o CLI confere a evidência no código, roda os testes e dá **PASS / CONCERNS / FAIL** em `verification.md` |
| `hubspec-archive` | no fim | só arquiva com o portão liberado: PASS, ou CONCERNS com cada item conferido ou justificado, e verificação em dia |
| `hubspec-hub` | num hub | orientar-se pelas docs antes do código; changes multi-repo com tasks `[repo]` na ordem de dependência; PRs |
| `hubspec-document` | num hub | escreve as docs de cada repo a partir da varredura do CLI e registra as dependências entre repos |

O formato é o do OpenSpec. Os arquivos extras (`exploration.md`, `decisions.md`, `verification.md`) têm os mesmos nomes do Studio, e uma change feita com o hubspec continua sendo uma change OpenSpec normal.

## Instalar

O hubspec ainda não está no npm. Por enquanto, ele é instalado a partir deste repositório, com o Bun só para gerar o build ([outras formas](docs/instalacao.md)):

```sh
git clone https://github.com/rafaelpolli/hubspec.git ~/hubspec
cd ~/hubspec && bun install && bun run build
ln -sf ~/hubspec/dist/cli.js ~/.local/bin/hubspec      # precisa do Node 22.12+
```

Sem Node, use o binário standalone: `bun run build:bin` gera `dist-bin/hubspec-<plataforma>`, um executável com tudo dentro.

No Claude Code, as skills também vêm como plugin. O plugin não traz o CLI, que continua precisando ser instalado como acima:

```
/plugin install hubspec --marketplace rafaelpolli/hubspec
```

## Começar

```sh
cd meu-projeto
hubspec init --tools claude,github-copilot,opencode,devin   # ou os ids das suas ferramentas, ou all
```

O `init` é o do OpenSpec. Ele cria `openspec/` e as skills e comandos `/opsx` padrão, e põe as skills `hubspec-*` ao lado deles, na pasta de cada ferramenta. Depois, no agente:

1. "quero explorar uma ideia: …" (opcional), até pedir "vira change";
2. "propor com decisões: …", para responder às decisões em aberto antes do proposal;
3. `/opsx:apply`;
4. "verificar a change";
5. "arquivar a change".

O passo a passo, com as saídas reais, está em [Primeiros passos](docs/primeiros-passos.md).

## Documentação

- [Instalar](docs/instalacao.md): a partir do código, como binário standalone e como plugin do Claude Code
- [Primeiros passos](docs/primeiros-passos.md): um projeto do zero até a primeira change arquivada
- [Verificação e portão](docs/verificacao.md): trace, runners, vereditos, prova vermelho → verde e o portão do archive
- [Hub multi-repo](docs/hub.md): sistemas com vários repositórios
- [Referência dos comandos](docs/comandos.md)
- [Problemas comuns](docs/problemas.md)

## O OpenSpec dentro do hubspec

O código do [OpenSpec](https://github.com/Fission-AI/OpenSpec) (MIT) está em `src/openspec/` e `schemas/`, na versão de `src/openspec/UPSTREAM.json` (hoje 1.16.0). O que muda em relação ao original está no [FORK.md](FORK.md). Em resumo:

- o comando é `hubspec`, inclusive nas skills e comandos `/opsx` que o `init` gera (`allowed-tools: Bash(hubspec:*)`);
- a config e os dados globais ficam em `~/.config/hubspec/` e `~/.local/share/hubspec/`, separados de um OpenSpec instalado ao lado;
- sem telemetria, sem checagem de versão nova e sem os comandos `feedback` e `install` (o instalador do binário do OpenSpec);
- o `archive` passa pelo portão da verificação, e o `init` e o `update` instalam as skills do hubspec.

As pastas dos projetos não mudam: `openspec/`, `openspec/config.yaml` e as changes são as do OpenSpec, e um projeto feito com o hubspec abre no OpenSpec e no Studio.

## Hub multi-repo

Para sistemas brownfield com vários repositórios, um repositório central (o hub) guarda quatro coisas:

- a lista dos repos (`repos.yaml`);
- a documentação de cada um, gerada a partir de uma varredura determinística e escrita pelo agente;
- o mapa de dependências;
- as changes que atravessam repos, com tasks `[repo]` na ordem de dependência.

O `hubspec hub pr` abre uma PR por repo, com as PRs irmãs e a ordem de merge.

```sh
hubspec hub init --repos-file repos.md     # um repo por linha: URL ou dono/repo
hubspec hub sync                           # clona em workspace/
# no agente: "documente o hub"
```

Num Git Flow, `hubspec hub init --repos-file repos.md --branch develop` faz os clones, as docs e as PRs partirem de `develop` ([a branch de trabalho](docs/hub.md#a-branch-de-trabalho-git-flow)).

O guia completo está em [Hub multi-repo](docs/hub.md).

## Desenvolvimento

```sh
bun install
bun run test        # gera dist/cli.js e roda os testes; os de CLI usam node dist/cli.js
bun run typecheck   # src/openspec/ no rigor do OpenSpec, o resto no do hubspec
bun run build:bin   # dist-bin/hubspec-<plataforma>, o binário standalone desta máquina
bun run gen:plugin  # depois de mudar os comandos do hub
```

O Bun só é usado no desenvolvimento (build e testes). O `bun run build` empacota tudo num arquivo só e gera o `THIRD_PARTY_LICENSES.md` com a licença de cada pacote que foi junto. Para trazer uma versão nova do OpenSpec, siga o [FORK.md](FORK.md).

A verificação foi portada de `packages/server/src/verification/` do OpenSpec Studio, com o projeto como único membro e o estado em arquivos (`.hubspec/` dentro da change) em vez do banco.
