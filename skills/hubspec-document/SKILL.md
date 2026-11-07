---
name: hubspec-document
description: Gerar ou atualizar a documentação dos repositórios de um hub multi-repo do hubspec (overview, arquitetura, interfaces, visão do sistema e dependências entre repos) a partir da varredura do CLI. Use depois de `hubspec hub sync` num hub novo, quando `hubspec hub status` mostrar docs desatualizadas, ou quando o usuário pedir "documentar o repo X".
license: MIT
compatibility: Requer o CLI hubspec e um hub com os repos clonados em workspace/.
metadata:
  author: hubspec
  version: "0.4.0"
---

A documentação tem duas etapas. O CLI faz a parte determinística: a varredura e os templates. Você escreve o texto, com base no que a varredura encontrou e no código.

**Entrada**: os repos a documentar. Sem repos, documente todos os ativos.

## 1. Varredura

Rode antes `hubspec hub sync`: as docs descrevem a branch de trabalho de cada repo (`branch` no `repos.yaml`; num Git Flow, `develop`), e o `hub document` recusa um clone que está em outra branch ou atrás do remote.

Rode `hubspec hub document [repos…]`. Para cada repo, o comando:

- grava `docs/repos/<repo>/.scan.json` com a árvore de pastas, as linguagens, os manifests de dependência, os endpoints que dá para detectar, os contratos (OpenAPI, AsyncAPI, protobuf, GraphQL), a infraestrutura, as configs e o CI;
- cria os templates que faltam: `overview.md`, `architecture.md` e `interfaces.md`. Cada seção vazia está marcada com `<!-- hubspec:preencher -->`. Os templates já existentes são mantidos.

## 2. Escrever as docs, repo por repo

Para cada repo, leia o `.scan.json` e, a partir dele, o código em `workspace/<repo>/`. Depois, preencha cada seção dos três arquivos:

- **Mantenha os títulos dos templates.** São fixos, para todos os repos ficarem iguais. Apague o marcador `<!-- hubspec:preencher -->` e a linha de dica em itálico de cada seção que você preencher.
- **Nível intermediário**: propósito, stack, componentes, uma linha por módulo ou pasta relevante, fluxos principais, contratos de API e eventos, e dependências entre repos. Não copie código. Não documente cada função.
- **Fundamente em fatos.** Use o que está no código e no `.scan.json`. Quando inferir algo, diga que é uma inferência. Uma seção sem conteúdo fica com "Não se aplica" e o motivo.
- **Num repo que já tinha docs**, atualize só o que o código novo mudou. Compare o `commit` do `.scan.json` com o do `.meta.json` (por exemplo, com `git -C workspace/<repo> log --stat <commit antigo>..HEAD`).

## 3. Dependências entre repos

Para cada dependência que você encontrar no código, registre-a no `repos.yaml`. Exemplos de dependência: uma chamada HTTP para outro repo do hub, um evento publicado por um e consumido por outro, ou um pacote de um repo usado por outro.

```sh
hubspec hub depends <repo> --add <outro> --via "<por onde: endpoint, evento, pacote>" --source llm
```

- Use `--remove` para uma dependência registrada que não existe mais no código. Se o `source` dela for `manual`, pergunte ao usuário antes de remover.
- O mapa do `system-overview.md` é regenerado a partir do `repos.yaml`. Não edite o trecho entre `<!-- hubspec:mapa:inicio -->` e `<!-- hubspec:mapa:fim -->`.
- Descreva a mesma dependência também em "Dependências entre repos" (`overview.md`) e em "Dependências externas" (`interfaces.md`).

## 4. Visão do sistema

Em `docs/system-overview.md`, preencha ou atualize:

- "O sistema": o que o sistema faz e como as peças se dividem;
- "Fluxos entre repos": os fluxos que atravessam mais de um repo, na ordem em que passam por eles, citando os repos.

## 5. Registrar

Rode `hubspec hub document --done [repos…]`. O comando:

- recusa se ainda houver alguma seção marcada a preencher, nas docs dos repos ou no `system-overview.md`;
- grava o `.meta.json` com o commit e a branch documentados;
- atualiza o mapa.

Mostre ao usuário o que foi escrito em cada repo, as dependências que você registrou (`source: llm`) e o que ficou como inferência. Peça para ele revisar antes de fazer commit e push do hub. Não faça commit sem que ele peça.
