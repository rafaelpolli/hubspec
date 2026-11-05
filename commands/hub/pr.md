---
description: Abre as PRs de uma change do hub, uma por repo, na ordem de merge
argument-hint: "[argumentos]"
---

Change: $ARGUMENTS

1. Rode `hubspec hub pr <change> --dry-run` e mostre o plano: quais repos terão PR e quais ficam de fora (com tasks em aberto).
2. Peça confirmação ao usuário: o comando faz commit do que estiver pendente na branch da change, push e abre as PRs pelo gh.
3. Com a confirmação, rode `hubspec hub pr <change>` e mostre os links e a ordem de merge.
