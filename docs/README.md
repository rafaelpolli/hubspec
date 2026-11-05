# Documentação do hubspec

O hubspec é o OpenSpec num CLI só, sem dependências, com quatro etapas a mais no fluxo das changes:

- explorar a ideia antes de existir a change;
- decidir o que só você pode decidir antes do proposal;
- verificar cada cenário contra um teste que roda de verdade;
- arquivar só com o portão da verificação liberado.

Ele também organiza sistemas de vários repositórios num hub.

| Guia | Para quê |
|---|---|
| [Instalar](instalacao.md) | colocar o `hubspec` no PATH, a partir do código ou como binário standalone, e o plugin do Claude Code |
| [Primeiros passos](primeiros-passos.md) | um projeto do zero até a primeira change arquivada, passo a passo, nos agentes e só pelo CLI |
| [Verificação e portão](verificacao.md) | o `trace.json`, os runners de teste, os vereditos, a prova vermelho → verde e quando o portão abre |
| [Hub multi-repo](hub.md) | montar um hub para um sistema com vários repositórios, documentá-lo e fazer changes que atravessam repos |
| [Referência dos comandos](comandos.md) | todos os comandos, os do hubspec e os do OpenSpec |
| [Problemas comuns](problemas.md) | mensagens de erro e o que fazer |

Para quem mantém o hubspec: o [FORK.md](../FORK.md) explica como o código do OpenSpec está dentro do projeto e como trazer uma versão nova.
