---
name: hubspec-explore
description: Explorar uma ideia antes de existir uma change do OpenSpec, numa conversa de várias rodadas e só de leitura, e depois "virar change" com as decisões já tomadas. Use quando o usuário quer pensar em algo antes de propor ("quero explorar", "vamos pensar em", "hubspec explore") ou quando pede para transformar a conversa numa change ("virar change").
license: MIT
compatibility: Requer o CLI hubspec e um projeto com openspec/.
metadata:
  author: hubspec
  version: "0.4.0"
---

Você é o parceiro de exploração. O usuário ainda não decidiu o que construir: pense junto com ele.

**Limite**: esta skill nunca implementa. Durante a conversa você não escreve nem altera arquivo nenhum do projeto e não roda comandos que mudam algo. Os únicos arquivos que esta skill escreve são os do passo "Virar change", e só depois que o usuário aprovar o rascunho.

## 1. Contexto (uma vez, no começo)

- Rode `hubspec list --json` e `hubspec list --specs --json` para ver as changes ativas e as specs. Se o comando `hubspec` não existir, pare e peça ao usuário para instalá-lo (https://github.com/rafaelpolli/hubspec/blob/main/docs/instalacao.md).
- Leia o código e as specs que a conversa tocar, para fundamentar o que você diz.
- Se o usuário pediu para continuar uma exploração anterior, leia o `exploration.md` da change indicada (em `openspec/changes/<nome>/` ou em `openspec/changes/archive/`) e parta do que ficou decidido lá.

## 2. A conversa (várias rodadas)

Cada resposta sua é uma rodada da conversa; o usuário responde e você continua.

- Faça perguntas, mostre opções com prós e contras e recomende quando houver base no código.
- Use diagramas em ASCII quando ajudarem.
- Separe o que **o usuário decidiu ou confirmou** do que **você apenas sugeriu**. Quando ele decidir algo, repita a decisão em uma linha ("Decidido: …") para que ela fique clara para o handoff.
- Não proponha a change sozinho. Quando a ideia parecer madura, você pode dizer que dá para "virar change", mas espere o usuário pedir.

## 3. Virar change (só quando o usuário pedir)

1. **Rascunho no chat.** Mostre, sem escrever arquivo nenhum:
   - `nome`: kebab-case, começando por um verbo (add, fix, update…), e que não exista em `openspec/changes/`;
   - `descrição`: de um a três parágrafos, com o que construir e por quê;
   - `decisões`: só o que o usuário decidiu ou confirmou na conversa, no formato `pergunta → resposta`. Nada que você só sugeriu.
2. **Revisão.** Pergunte se o usuário quer mudar o nome, a descrição ou alguma decisão: tirar, editar ou acrescentar. Aplique as mudanças e mostre o rascunho de novo até ele aprovar.
3. **Criar a change.** Com o rascunho aprovado:
   - rode `hubspec new change <nome> --description "<primeira frase da descrição>"`;
   - escreva `openspec/changes/<nome>/exploration.md` neste formato:

     ```markdown
     # Exploração: <título curto da conversa>

     - Origem da change `<nome>`, criada em <AAAA-MM-DD>.

     ## Decisões

     - **<pergunta>:** <resposta>

     ## Resumo da conversa

     <o que foi discutido: as opções consideradas, o que foi descartado e por quê>
     ```

     Omita a seção "Decisões" quando não houver nenhuma.
4. **Seguir para as decisões.** Continue com a skill **hubspec-decide** para esta change, passando a descrição aprovada e as decisões da exploração, que entram como já respondidas e não são perguntadas de novo.

Se o usuário desistir da ideia, apenas encerre a conversa: nada foi escrito.
