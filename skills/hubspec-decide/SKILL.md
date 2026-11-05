---
name: hubspec-decide
description: Checkpoint de decisões antes do proposal de uma change do OpenSpec. Levanta as decisões que só o usuário pode tomar (escopo, comportamento visível, compatibilidade, critérios de aceite), pergunta, grava decisions.md e só então gera os artefatos com o propose padrão. Use antes de propor uma change ("hubspec decide", "propor com decisões") ou quando a skill hubspec-explore passar uma change para cá.
license: MIT
compatibility: Requer o CLI hubspec, as skills openspec-* padrão e um projeto com openspec/.
metadata:
  author: hubspec
  version: "0.4.0"
---

Antes de escrever qualquer artefato, descubra o que só o usuário pode decidir e pergunte. É o que evita que o agente decida sozinho e escreva as suposições direto no proposal.

Se o comando `hubspec` não existir, pare e peça ao usuário para instalá-lo (https://github.com/rafaelpolli/hubspec/blob/main/docs/instalacao.md).

**Entrada**: o nome de uma change (kebab-case) ou a descrição do que construir. Pode vir da skill hubspec-explore, já com a descrição aprovada e as decisões da exploração.

## 1. A change

- Se a change ainda não existe, crie-a: escolha um nome kebab-case a partir da descrição e rode `hubspec new change <nome> --description "<uma frase>"`.
- Se ela já tem `proposal.md`, avise que o checkpoint vem antes do proposal e pergunte se o usuário quer refazer as decisões assim mesmo. Se ele quiser, siga até o passo 4. Mudar uma resposta deixa os artefatos já escritos "a revisar": diga isso ao usuário e, no fim, sugira a skill openspec-update-change.
- Leia `openspec/changes/<nome>/exploration.md`, se existir: as decisões dele já estão tomadas.

## 2. Levantar as decisões

Leia a descrição, as specs relacionadas (`hubspec list --specs`) e o código. **Num hub** (há um `repos.yaml` na raiz), leia antes o `docs/system-overview.md` e as docs dos repos envolvidos (skill **hubspec-hub**). Uma decisão comum ali é em quais repos a mudança acontece e em que ordem. Liste **de 0 a 8** decisões que só o usuário pode tomar:

- escopo: o que entra e o que fica de fora;
- comportamento visível para quem usa;
- compatibilidade e migração;
- critérios de aceite.

Regras:

- Não liste detalhes de implementação que você mesmo pode decidir.
- Não repita nenhuma decisão da exploração.
- Cada decisão tem pelo menos duas opções, uma recomendada e uma linha sobre por que ela importa.

Se não houver nada a decidir, diga isso em uma frase e vá para o passo 4.

## 3. Perguntar

Mostre todas as decisões de uma vez. Cada uma com a pergunta, o porquê, as opções e a recomendada marcada.

- No Claude Code, use a ferramenta `AskUserQuestion`, com até 4 perguntas por chamada e a opção recomendada primeiro, terminando em "(Recomendado)".
- Nas outras ferramentas, use uma lista numerada no chat, para o usuário responder por número (por exemplo `1b, 2a, 3: só CSV`).

O usuário pode:

- escolher uma opção;
- escrever a própria resposta;
- dizer **"aceitar recomendações"**, que responde todas com a recomendada;
- dizer **"pular"**: o checkpoint fica pulado e os artefatos são gerados sem respostas.

## 4. Gravar `decisions.md`

Escreva `openspec/changes/<nome>/decisions.md`:

```markdown
# Decisões: <nome>

- Checkpoint: respondido   (ou: sem decisões a tomar / pulado pelo usuário)

## Decisões

### <pergunta>

<por que importa>

- Opções: <opção A> (recomendada); <opção B>
- Resposta: <texto da resposta> (recomendada | outra opção | resposta própria | da exploração)
```

As decisões da exploração entram também, com a origem `da exploração`.

## 5. Gerar os artefatos

Siga a skill **openspec-propose** (o `/opsx:propose` padrão) para esta change, com uma regra a mais: as respostas de `decisions.md` são requisitos.

- O proposal e as specs seguem o que foi decidido.
- Não contradiga nenhuma resposta.
- Uma suposição sua que vá além das decisões entra no `design.md`, numa seção "Suposições", para o usuário ver.
- **Num hub**, o `tasks.md` segue as regras da skill **hubspec-hub**: tasks agrupadas por repo, na ordem de dependência; cada task começa com `[repo]` e termina com o componente ou caminho alvo; um repo novo começa por uma task `[manual]`, que bloqueia as demais.

Ao terminar, pare como o propose manda. A implementação começa só quando o usuário pedir o apply. Depois do apply, a verificação é a skill **hubspec-verify**.
