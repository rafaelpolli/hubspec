---
name: hubspec-verify
description: Verificar uma change implementada do OpenSpec. Liga cada cenário das delta specs a um teste automatizado, roda os testes com o CLI hubspec e dá o veredito PASS, CONCERNS ou FAIL em verification.md. Use depois do apply, antes do archive ("verificar a change", "hubspec verify", "os cenários estão cobertos?").
license: MIT
compatibility: Requer o CLI hubspec, Git para a prova opcional e um projeto com openspec/.
metadata:
  author: hubspec
  version: "0.4.0"
---

A verificação confere, sem confiar só em você, que cada cenário da change tem um teste e que esse teste passa. O seu papel é apontar os testes. O CLI `hubspec` confere a evidência no código, roda os testes e decide o veredito.

Se o comando `hubspec` não existir, pare e peça ao usuário para instalá-lo (https://github.com/rafaelpolli/hubspec/blob/main/docs/instalacao.md).

**Limite**: esta skill não corrige código nem testes. Quando algo falhar, mostre o que falhou e sugira o que fazer. Mudanças só com o pedido do usuário, pelo apply.

## 1. Os cenários

Rode `hubspec scenarios <change>`, que lista os cenários das seções ADDED e MODIFIED com o id de cada um.

Se não houver cenários, pule para o passo 3: a verificação só confere as tasks.

## 2. O trace: qual teste exercita cada cenário

Rode `hubspec scenarios <change> --template`. Ele cria `openspec/changes/<change>/.hubspec/trace.json`, com um item por cenário. Se o arquivo já existir, edite-o.

Para cada cenário, encontre no código o teste que exercita **exatamente** o comportamento descrito e preencha o item:

```json
{ "id": "<id do cenário, sem mudar>", "kind": "teste", "file": "<caminho relativo à raiz do projeto>", "line": 41, "name": "<nome do teste>", "note": "<opcional>" }
```

- `kind` é um destes três valores:
  - `"teste"`, quando um teste exercita o cenário;
  - `"manual"`, quando o cenário não dá para automatizar (por exemplo, algo visual);
  - `"sem-teste"`, quando dá para automatizar, mas nenhum teste o exercita.
- **Num hub** (há um `repos.yaml` na raiz), cada item de teste leva também `"repo": "<nome do repo>"`, e `file` é relativo a `workspace/<repo>/`. O teste roda dentro do clone desse repo, e a verificação fica desatualizada quando qualquer repo clonado muda.
- `line` é a linha onde o teste é declarado.
- `name` é o nome do teste copiado do código, sem os nomes dos `describe`.
- Não aponte um teste só porque o arquivo trata do mesmo assunto. Na dúvida, use `"sem-teste"` e explique em `note`.
- Nos itens que não são `"teste"`, apague `file`, `line` e `name`.
- Não escreva nenhum outro arquivo.

## 3. Rodar

Rode `hubspec verify <change>`. Ele faz quatro coisas:

- confere a evidência: o arquivo existe e o nome do teste está na linha ou até 5 linhas depois;
- roda cada teste sozinho (bun, vitest, jest ou pytest);
- confere as tasks pendentes do `tasks.md`;
- escreve `verification.md`.

O código de saída é 0 para PASS, 2 para CONCERNS e 1 para FAIL.

**Prova opcional**: com `--prove <commit de antes da change>`, cada teste que passou roda também sobre o código antigo e recebe uma de três notas:

- **forte**: falhava antes e passa agora;
- **fraca**: já passava antes, então não prova a mudança;
- **inconclusiva**.

Ofereça a prova quando o usuário quiser confiança extra. Ela precisa de Git e de um commit de antes da change; por padrão é o `HEAD`, quando a change ainda não foi commitada. Num hub, o mesmo commit-ish (por exemplo `main`) é usado em cada repo.

## 4. Mostrar o veredito

Mostre o resumo que o comando imprime, com os itens numerados (`#n`), e explique:

- **FAIL**: há teste falhando. Mostre a saída do teste e sugira corrigir pelo apply. Depois, verifique de novo.
- **CONCERNS**: cada um destes itens precisa de uma ação do usuário:
  - **manual**: o usuário confere à mão e você registra com `hubspec check <change> <n> --note "<o que ele conferiu>"`;
  - **sem teste** ou **evidência inválida**: sugira escrever o teste e verificar de novo. Se o usuário aceitar assim, registre o motivo dele com `hubspec justify <change> <n> "<motivo>"`;
  - **tasks pendentes**: terminar as tasks ou justificar.
- **PASS**: pode arquivar com a skill **hubspec-archive**.

Nunca rode `check` ou `justify` por conta própria: o texto vem do usuário.

Qualquer mudança no código ou nos artefatos depois da verificação a deixa desatualizada, e o portão do archive fecha até verificar de novo.
