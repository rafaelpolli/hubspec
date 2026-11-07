# Hub multi-repo

Quando o sistema está espalhado por vários repositórios, o agente de um repo não enxerga os outros. O hub é um repositório central que guarda:

- a lista dos repositórios do sistema;
- a documentação gerada a partir deles;
- as specs e as changes do OpenSpec, inclusive as que atravessam repos.

O agente consulta o hub para saber quais peças existem, como elas conversam e em que repos uma mudança precisa acontecer.

```
hub/
  repos.yaml              # manifesto: os repos, a branch de trabalho e as dependências
  AGENTS.md               # as regras do hub, comuns a todos os agentes
  CLAUDE.md               # só importa o AGENTS.md (Claude Code)
  .gitignore              # com workspace/
  docs/
    system-overview.md    # visão do sistema e mapa de dependências (o mapa é gerado do repos.yaml)
    repos/<nome>/
      overview.md         # escritos pelo agente
      architecture.md
      interfaces.md
      .scan.json          # a varredura do hub document
      .meta.json          # o commit documentado (hub document --done)
    archive/<nome>/       # docs de repos aposentados (hub archive)
  openspec/
    config.yaml           # com as regras do hub
    specs/                # as specs vigentes
    changes/              # as changes em andamento; archive/ guarda as concluídas
  workspace/<nome>/       # os clones (hub sync), fora do Git do hub
  .claude/ .github/ .opencode/ .devin/   # as skills e os comandos de cada ferramenta
```

O que vai em cada doc está em [O que tem em cada doc](#o-que-tem-em-cada-doc). As pastas das ferramentas estão em [Os agentes no hub](#os-agentes-no-hub), e a pasta de uma change, em [Primeiros passos](primeiros-passos.md#a-pasta-de-uma-change).

Todos os comandos do hub rodam na raiz do hub: `hubspec hub <comando>`. Para abrir PRs, é preciso o gh CLI autenticado (`gh auth login`). Por enquanto, o hub só trabalha com repositórios no GitHub.

## 1. Criar o hub

Crie um repositório vazio para o hub, clone-o e informe os repos do sistema:

```sh
git clone git@github.com:acme/hub.git && cd hub
hubspec hub init --repos-file repos.md
```

O `--repos-file` aceita um documento de texto qualquer. Ele pega um repo por linha:

- uma URL em qualquer lugar da linha: simples, entre `<>` ou num link Markdown;
- ou uma linha que comece com `dono/repo`, o atalho do GitHub: em `acme/api`, `acme` é o usuário ou a organização a que o repo pertence.

O resto da linha vira a descrição do repo, e títulos e prosa são ignorados:

```markdown
# Repositórios do sistema de pagamentos

- https://github.com/acme/api — API de pagamentos
- [worker](git@github.com:acme/worker.git): processa eventos
- acme/front - tela web
```

O arquivo só diz quais repos fazem parte do sistema. Em cada linha, só o endereço é obrigatório:

- **A descrição é opcional.** Num repo sem descrição, o agente escreve uma ao documentar o hub: uma frase sobre o que o repo faz. Ele não mexe numa descrição que já existe, como as que vêm do arquivo. Para trocar uma descrição, use `hubspec hub add <url> --description "…"`.
- **As dependências não vão no arquivo.** O `--repos-file` não as lê, nem quando a descrição fala de outro repo, como "consome os eventos da api". Quem as grava no `repos.yaml` é o agente, quando você pede para documentar o hub ([passo 3](#3-documentar)): ele as encontra lendo o código dos repos.
- **A branch também não vai.** Ela vem do `--branch` ou da branch padrão do remote ([a branch de trabalho](#a-branch-de-trabalho-git-flow)).

Também dá para passar os repos direto, com `--repos https://github.com/acme/api acme/worker`, ou criar o hub vazio e acrescentar os repos depois com `hub add`.

Um repo informado como `dono/repo` vira uma URL do GitHub no protocolo que a máquina usa, conforme o `gh config get git_protocol`: `git@github.com:…` com SSH, `https://github.com/…` sem. As URLs completas ficam como estão.

O `hub init` faz quatro coisas:

- cria `repos.yaml`, `AGENTS.md`, `docs/` e `openspec/`;
- põe `workspace/` no `.gitignore`;
- grava as regras do hub no `openspec/config.yaml`;
- instala as skills e os comandos dos agentes.

Por padrão, ele instala para Claude Code, Devin, GitHub Copilot e OpenCode. Para mudar a lista, use `--tools`, por exemplo `--tools claude,cursor` ou `--tools all`.

### A branch de trabalho (Git Flow)

Cada repo tem uma branch de trabalho, o campo `branch` do `repos.yaml`. Todo o hub parte dela:

| Comando | Usa a branch de trabalho para |
|---|---|
| `hub sync` | clonar (`git clone --branch`) e atualizar (`pull --ff-only`) |
| `hub document` | documentar: recusa um clone em outra branch ou atrás de `origin/<branch>` |
| `hub status` | comparar o commit documentado com `origin/<branch>` |
| `hub pr` | criar a branch da change a partir dela e abrir a PR para ela (`gh pr create --base`) |

Sem `--branch`, cada repo usa a branch padrão do remote, que costuma ser `main`. Num Git Flow, as PRs de feature vão para `develop`, as de release para homologação e só elas chegam à `main`. Nesse caso, informe a branch no `init`:

```sh
hubspec hub init --repos-file repos.md --branch develop
```

O `repos.yaml` passa a ter a branch do hub no topo. Os repos sem `branch` própria seguem essa branch:

```yaml
version: 1
branch: develop
repos:
  - name: api
    url: git@github.com:acme/api.git
    path: workspace/api
    # …
  - name: infra
    url: git@github.com:acme/infra.git
    branch: main          # este repo trabalha em outra branch
    path: workspace/infra
```

- **Um repo sem a branch.** Ao registrar o repo, o hubspec confere se o remote tem a branch do hub. Se não tiver, ele avisa, e o `sync` falha nesse repo com `o remote não tem a branch develop`. Se o repo trabalha em outra branch, informe-a: `hubspec hub add <url> --branch main`.
- **Um hub que já existe.** Rode `hubspec hub init --branch develop` de novo. Os repos passam para `develop`, inclusive os que tinham branch própria. A saída lista cada repo e a branch de antes, para você refazer as exceções com `hub add <url> --branch`. Depois, o `hub sync` troca a branch dos clones, desde que nada se perca. As docs passam a aparecer como desatualizadas no `hub status`, com o aviso `as docs descrevem a branch main`. Rodar de novo com a mesma branch não muda nada.
- **Fora do hub.** As PRs de release e de produção, e o fluxo do próprio repositório do hub, ficam com o time. O hubspec não faz commit no hub.

## 2. Clonar

```sh
hubspec hub sync
```

O `sync` clona em `workspace/<repo>/` os repos que faltam e atualiza os que já estão lá.

## 3. Documentar

Peça ao agente: "documente o hub". A skill **hubspec-document** faz o trabalho em três passos:

1. Roda `hubspec hub document`. Esse passo é determinístico. Para cada repo, ele varre a árvore, as linguagens, os manifests, os endpoints, os contratos (OpenAPI, AsyncAPI, protobuf, GraphQL), a infraestrutura, as configs e o CI, e grava o resultado em `docs/repos/<repo>/.scan.json`. Também cria os templates `overview.md`, `architecture.md` e `interfaces.md`.
2. Escreve o texto de cada seção a partir da varredura e do código. Quem escreve é o agente da sua sessão, sem chave de API própria. Neste passo, ele também grava no `repos.yaml` as dependências entre os repos (veja abaixo) e uma descrição para cada repo que estiver sem, tirada do propósito que ele escreveu.
3. Roda `hubspec hub document --done`. Esse comando grava em `.meta.json` o commit documentado de cada repo e recusa enquanto restar uma seção `<!-- hubspec:preencher -->`.

Revise as docs e faça o commit:

```sh
git add -A && git commit -m "hub: docs iniciais" && git push
```

O mapa de dependências do `docs/system-overview.md` é gerado a partir do `repos.yaml`. As dependências que o agente encontrou (`source: llm`) aparecem com ¹. Não edite à mão o trecho entre `<!-- hubspec:mapa:inicio -->` e `<!-- hubspec:mapa:fim -->`.

### O que tem em cada doc

| Arquivo | Quem escreve | O que tem |
|---|---|---|
| `overview.md` | o agente | Propósito · Stack · Como rodar · Dependências entre repos |
| `architecture.md` | o agente | Componentes · Módulos e pastas · Fluxos principais |
| `interfaces.md` | o agente | APIs expostas · Eventos · Contratos · Dependências externas |
| `.scan.json` | o `hub document` | a varredura do repo: `repo`, `commit`, `branch`, `scannedAt`, a árvore de pastas (`tree`), `files`, `languages`, `manifests`, `endpoints`, `contracts`, `infra`, `configs` e `ci`, e `truncated` quando a varredura parou num limite |
| `.meta.json` | o `hub document --done` | `repo`, `commit`, `branch` e `documentedAt`: o commit que as docs descrevem |
| `docs/system-overview.md` | o agente e o CLI | O sistema · Fluxos entre repos, escritos pelo agente; Mapa, gerado do `repos.yaml` |

- **Os títulos das seções são fixos**, iguais em todos os repos. Uma seção vazia tem o marcador `<!-- hubspec:preencher -->` e uma dica em itálico, e o `--done` recusa enquanto restar alguma.
- **O `hub document` cria só os templates que faltam.** Um texto já escrito nunca é sobrescrito. O `.scan.json` é refeito a cada execução.
- **O `hub status` compara o `commit` do `.meta.json` com o `origin/<branch>`** do repo. É assim que ele sabe que as docs estão desatualizadas.

### As dependências entre os repos

Você não informa as dependências: o agente as encontra no código. No passo 2, ele procura o que liga um repo a outro, como uma chamada HTTP para a API de outro repo do hub, um evento que um publica e outro consome, ou um pacote de um repo usado por outro. Para cada uma, ele roda:

```sh
hubspec hub depends worker --add api --via "evento PixRecebido" --source llm
```

O comando grava a dependência no `repos.yaml`, com `source: llm`, e regenera o mapa. Algumas ressalvas:

- **Só o agente faz isso.** Rodado no terminal, o `hubspec hub document` só varre os repos e cria os templates. A varredura lista as dependências de pacotes (npm, pip…), mas não descobre as que existem entre os repos do hub.
- **É uma inferência.** O agente vê o que está no código e pode deixar passar uma dependência que só existe na configuração de produção. Por isso, as que ele encontrou aparecem com ¹ no mapa, para você conferir.
- **O `--done` não confere as dependências.** Ele aceita um `repos.yaml` sem nenhuma, o que também é o certo quando os repos não dependem uns dos outros.
- **Uma dependência que o agente não achou** você registra à mão: `hubspec hub depends front --add api --via "GET /pagamentos/:id"`. Ela fica com `source: manual`, e o agente pergunta antes de removê-la.
- **Ao atualizar as docs**, o agente refaz esse passo: acrescenta as dependências novas e tira as que sumiram do código.

## 4. Perguntar sobre o sistema

Com o hub documentado, pergunte ao agente, por exemplo: "como funciona o pagamento?" ou "em quais repos mexer para aceitar Pix?". A skill **hubspec-hub** segue esta ordem:

1. lê o `system-overview.md`;
2. lê as docs dos repos envolvidos;
3. abre o código em `workspace/` só quando as docs não bastam, e nesse caso avisa que a doc estava incompleta.

Na resposta, ele cita as docs em que se baseou.

## 5. Uma change que atravessa repos

Uma mudança no sistema é **uma change só**, no `openspec/` do hub. O fluxo é o de sempre: explorar, decidir, propor.

No hub, a **hubspec-explore** e a **hubspec-decide** leem o `system-overview.md` e as docs dos repos antes do código. A exploração continua só de leitura: ela não roda `hub sync` nem `hub document`, e pede a você o comando quando falta um clone ou uma doc. Quando você pede "vira change", a descrição do rascunho diz em quais repos a change acontece.

A diferença está no `tasks.md`:

- as tasks ficam agrupadas por repo, na ordem de dependência: primeiro quem os outros consomem;
- toda task começa com `[repo]` ou `[manual]`;
- uma dependência entre repos que a change cria vai no título da seção.

```markdown
## 1. api
- [ ] 1.1 [api] Publicar o evento PixRecebido — `src/events/`

## 2. worker (depende de: api)
- [ ] 2.1 [worker] Consumir PixRecebido — `internal/pix/`
```

O `hub init` gravou essas regras no `openspec/config.yaml` (nos campos `context`, `rules.proposal`, `rules.tasks` e `operations.apply.guidance`). O OpenSpec entrega esses campos ao agente no `/opsx:propose` e no `/opsx:apply` padrão, então as regras valem em todas as ferramentas, mesmo sem as skills do hubspec.

No apply, o agente implementa cada task dentro do clone do repo (`workspace/<repo>/`) e não faz commit nos clones: isso fica para o `hub pr`.

### Repo novo

O agente não cria repositórios. Se a change precisa de um repo novo, a primeira task é manual e bloqueia as outras:

```markdown
## 1. Manual
- [ ] 1.1 [manual] Criar repo `pix-gateway` via issue na automação da organização (bloqueia as demais)
```

Depois de criar o repo, rode:

```sh
hubspec hub add git@github.com:acme/pix-gateway.git --new --change add-pix
```

O comando faz quatro coisas:

- registra e clona o repo;
- vincula o repo à change;
- marca o repo como `template: true`, para o agente seguir a estrutura que o template já criou;
- conclui a task `[manual]`.

## 6. Verificar num hub

A verificação é a mesma de um projeto só ([Verificação e portão](verificacao.md)), com duas diferenças:

- Cada item do trace leva o repo do teste, e `file` é relativo ao clone desse repo:

  ```json
  { "id": "pix/Pagamento/Confirma", "kind": "teste", "repo": "worker", "file": "internal/pix/pix_test.go", "line": 12, "name": "TestConfirma" }
  ```

  O teste roda dentro de `workspace/<repo>/`.
- A verificação fica desatualizada quando qualquer repo clonado muda.

Com `--prove <commit>`, o mesmo commit-ish é usado em cada repo. Depois do `hub pr`, use a branch de trabalho: `--prove develop` num Git Flow.

## 7. Abrir as PRs

```sh
hubspec hub pr add-pix --dry-run     # mostra o plano
hubspec hub pr add-pix
```

Para cada repo com todas as tasks concluídas, o comando:

1. cria a branch com o nome da change, a partir da branch de trabalho do repo;
2. faz commit do que estiver pendente e dá push;
3. abre a PR para a branch de trabalho, com `gh pr create --base <branch>`;
4. escreve em cada PR as PRs irmãs e a ordem de merge;
5. grava o link na task (`→ PR: <url>`).

A ordem de merge segue as dependências do `repos.yaml` e as declaradas na change. Quando duas valem o mesmo, a ordem das tasks desempata. Rodar de novo reaproveita as PRs abertas. Enquanto houver uma task `[manual]` aberta, o comando recusa.

## 8. Depois do merge

```sh
hubspec hub status     # docs desatualizadas contra a branch de trabalho no remote; exit 1 se houver
hubspec hub sync       # volta os clones para a branch de trabalho e traz o merge
```

- O `status` compara as docs com o remote, então mostra o merge antes de qualquer sync.
- O `sync` volta para a branch de trabalho os clones que ficaram na branch da change, desde que estejam limpos e com todos os commits no remote.
- Para cada repo com doc desatualizada, peça "atualize as docs do worker". A **hubspec-document** atualiza só o que o código novo mudou.
- O `hub document` só documenta a branch de trabalho em dia, e recusa um clone em outra branch ou atrás do remote.

## 9. Aposentar ou remover um repo

```sh
hubspec hub archive legado        # fica no manifesto como arquivado; as docs vão para docs/archive/
hubspec hub remove legado --yes   # tira do manifesto e apaga as docs e o clone
```

Os dois avisam quando outros repos ainda declaram dependência do repo alvo, e mostram o `hub depends … --remove` para tirá-la; nenhum dos dois mexe nessas dependências sozinho.

O `remove`:

- pede confirmação (`--yes`);
- nunca apaga nada fora do hub;
- recusa um clone com trabalho não enviado, a não ser com `--force`;
- não dá erro se for rodado de novo.

## O `repos.yaml`

No topo, `branch` é a branch de trabalho do hub ([Git Flow](#a-branch-de-trabalho-git-flow)). É opcional. Cada repo tem estes campos:

| Campo | O que é |
|---|---|
| `name`, `url`, `path` | identificação e onde fica o clone |
| `branch` | a branch de trabalho do repo. Sem ela, vale a do hub; sem nenhuma das duas, `main`. O hubspec só a grava quando ela é diferente da do hub |
| `description`, `tags` | para o agente e para o mapa. A descrição vem do resto da linha no `--repos-file` ou do `hub add --description`; sem nenhum dos dois, o agente escreve uma ao documentar. As tags vêm do `hub add --tags` |
| `dependsOn` | dependências: um nome (`api`) ou `{ repo, via, source }`. O agente as grava ao documentar, com `source: llm` ([como](#as-dependências-entre-os-repos)); as suas, do `hub depends` ou do `hub add --depends`, ficam com `source: manual`. Não vêm do `--repos-file` |
| `status` | `active` ou `archived` |
| `changes`, `template` | nos repos criados pela automação para uma change |

Prefira mudar as dependências com o `hub depends`, que regenera o mapa:

```sh
hubspec hub depends worker --add api --via "evento PixRecebido"
hubspec hub depends worker --remove legado
hubspec hub depends worker --set api,auth --source manual
```

## Os agentes no hub

O `AGENTS.md` é o ponto de entrada comum. Cada ferramenta recebe as skills e os comandos `/opsx` de um projeto comum ([as pastas de cada ferramenta](primeiros-passos.md#as-pastas-de-cada-ferramenta)). Além deles, o `hub init` escreve:

| Ferramenta | Arquivos | Comandos |
|---|---|---|
| Claude Code | `CLAUDE.md` com `@AGENTS.md`, `.claude/commands/hub/` | `/hub:status`, `/hub:sync`, `/hub:document`, `/hub:add`, `/hub:pr` |
| OpenCode | `.opencode/commands/hub-*.md` | `/hub-status`… |
| GitHub Copilot | `.github/prompts/hub-*.prompt.md`, `copilot-instructions.md` apontando para o `AGENTS.md` | `/hub-status`… |
| Devin | `.devin/workflows/hub-*.md` (Devin Desktop), `.devin/playbooks/hub-*.devin.md`, `.devin/knowledge/hub.md` | `/hub-status`… |

Os playbooks e o knowledge do Devin na nuvem são cadastrados pela web: importe esses arquivos lá. Rodar o `hub init` de novo atualiza só as seções do hubspec nesses arquivos.

Fora do escopo por enquanto: atualização automática das docs (webhooks, CI) e provedores Git além do GitHub.
