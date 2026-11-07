---
name: hubspec-hub
description: Trabalhar num hub multi-repo do hubspec, um repositório central com repos.yaml, docs/ e openspec/ cujo código fica em workspace/. Use para responder como o sistema funciona, para saber em quais repos uma mudança precisa acontecer, ou para propor e implementar uma change que atravessa repos ("como funciona o pagamento?", "propor X no sistema", "em quais repos mexer?").
license: MIT
compatibility: Requer o CLI hubspec, um hub criado com `hubspec hub init` e, para as PRs, o gh CLI autenticado.
metadata:
  author: hubspec
  version: "0.4.0"
---

O hub guarda o mapa do sistema; o código fica nos clones em `workspace/<repo>/`. As regras completas estão no `AGENTS.md` da raiz. Esta skill é o roteiro para segui-las.

## Orientar-se antes de responder

1. Leia `docs/system-overview.md`, com a visão do sistema e o mapa: repos, dependências e repos aposentados.
2. Leia as docs dos repos envolvidos, nesta ordem: `docs/repos/<repo>/overview.md`, depois `architecture.md` e `interfaces.md`.
3. Abra o código em `workspace/<repo>/` só quando as docs não bastarem. Quando isso acontecer, diga que a doc estava incompleta e sugira atualizá-la com a skill **hubspec-document**.
4. Se um clone faltar, rode `hubspec hub sync`.
5. Se não tiver certeza de que as docs refletem o código, rode `hubspec hub status`. Uma doc desatualizada pode estar errada: avise o usuário.

Ao responder, diga em quais repos e arquivos de doc a resposta se baseia.

## Propor uma change que atravessa repos

Uma mudança no sistema é **uma change só**, no `openspec/` do hub. Use o fluxo de sempre: **hubspec-decide** e depois o propose. No `tasks.md`, siga estas regras:

- Agrupe as tasks por repo, uma seção por repo (`## 2. api`), **na ordem de dependência**. Venha primeiro quem os outros consomem (contrato, lib, API) e depois quem consome. O mapa do `system-overview.md` mostra a ordem.
- **Declare as dependências entre repos da change** no título da seção: `## 3. worker (depende de: api)`. Faça isso principalmente para uma dependência que a change cria e que ainda não está no `repos.yaml`. O `hub pr` usa essas dependências, mais as do `repos.yaml`, para a ordem de merge.
- Toda task começa com o repo entre colchetes e termina com o componente ou caminho alvo:

  ```markdown
  ## 1. api

  - [ ] 1.1 [api] Publicar o evento PixRecebido — `src/events/`

  ## 2. worker (depende de: api)

  - [ ] 2.1 [worker] Consumir PixRecebido e confirmar o pagamento — `internal/pix/`
  ```

- **Repo novo**: o agente não cria repositórios. A primeira task é manual e bloqueia todas as outras:

  ```markdown
  ## 1. Manual

  - [ ] 1.1 [manual] Criar repo `<nome>` via issue na automação da organização (bloqueia as demais)
  ```

  Depois que o usuário criar o repo, ele roda `hubspec hub add <url> --new --change <change>`. Esse comando registra e clona o repo, marca a task manual como concluída e registra o repo como `template: true`. Enquanto houver uma task `[manual]` aberta, o `hub pr` recusa.
- Num repo com `template: true` no `repos.yaml`, siga a estrutura que o template já criou. Não recrie pastas, pipelines nem arquivos de infraestrutura que já existem.
- Nas specs, escreva cenários que digam onde cada comportamento acontece. Na verificação, cada teste é apontado com o seu repo.

## Implementar (apply)

- Implemente cada task dentro do clone do repo indicado (`workspace/<repo>/`), na ordem do `tasks.md`.
- Não comece um repo enquanto houver uma task `[manual]` em aberto antes dele.
- Não faça commit nos clones por conta própria: o `hub pr` faz isso na branch da change.

## Abrir as PRs

Com as tasks de um repo concluídas:

1. Rode `hubspec hub pr <change> --dry-run` e mostre o plano.
2. Peça confirmação.
3. Rode `hubspec hub pr <change>`.

O comando cria a branch `<change>` em cada repo, a partir da branch de trabalho do repo (`branch` no `repos.yaml`; num Git Flow, `develop`). Depois faz commit do que estiver pendente, faz push e abre a PR pelo gh para a branch de trabalho, e lista nela as PRs irmãs e a ordem de merge. Os links das PRs ficam gravados nas tasks. As PRs de release e de produção seguem o fluxo do time, fora do hub.

## Depois do merge

1. Rode `hubspec hub status`. Ele compara as docs com a branch de trabalho no remote, então já mostra o merge.
2. Rode `hubspec hub sync`. Ele volta os clones da branch da change para a branch de trabalho (quando nada se perde) e traz o merge.
3. Para cada repo com doc desatualizada, sugira atualizar com a skill **hubspec-document**.
