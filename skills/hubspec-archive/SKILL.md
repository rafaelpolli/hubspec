---
name: hubspec-archive
description: Arquivar uma change do OpenSpec atrás do portão da verificação. Só arquiva com veredito PASS, ou CONCERNS com cada item justificado, e quando a verificação não está desatualizada. Use para finalizar uma change verificada ("arquivar", "hubspec archive").
license: MIT
compatibility: Requer o CLI hubspec e um projeto com openspec/.
metadata:
  author: hubspec
  version: "0.4.0"
---

Arquive a change só quando a verificação permitir. Se o comando `hubspec` não existir, pare e peça ao usuário para instalá-lo (https://github.com/rafaelpolli/hubspec/blob/main/docs/instalacao.md).

1. Rode `hubspec gate <change>`.
   - **Portão fechado**: mostre o motivo e o caminho. Não arquive.
     - Sem verificação, ou verificação desatualizada: rode a skill **hubspec-verify**.
     - Testes falhando: corrija pelo apply e verifique de novo.
     - Itens em CONCERNS sem justificativa: peça ao usuário o motivo de cada um e registre com `hubspec justify <change> <n> "<motivo>"`. Se o item for manual, use `hubspec check <change> <n> --note "<o que ele conferiu>"`.
   - **Portão liberado**: siga para o passo 2.
2. Mostre o que vai acontecer: as delta specs são mescladas nas specs principais e a change vai para `openspec/changes/archive/`, junto com `verification.md`, `decisions.md` e `exploration.md`. Peça confirmação ao usuário.
3. Com a confirmação, rode `hubspec archive <change> -y`. Ele confere o portão de novo antes de arquivar.
4. Mostre o resultado. Se o projeto usa Git, sugira um commit, mas só faça o commit se o usuário pedir.

Nunca contorne o portão: não use `--no-gate` nem mova a pasta da change por conta própria, a não ser que o usuário peça explicitamente para arquivar sem verificação.
