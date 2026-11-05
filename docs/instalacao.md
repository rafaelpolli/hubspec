# Instalar

Instalar o hubspec não traz mais nada: ele já tem o OpenSpec dentro e não depende do pacote `@fission-ai/openspec`. Há duas formas de usá-lo:

| Forma | Precisa para rodar | Tamanho |
|---|---|---|
| **CLI em Node**: `dist/cli.js`, um arquivo só com o OpenSpec e as bibliotecas dentro | Node 22.12 ou mais novo | ~2 MB |
| **Binário standalone**: um executável por plataforma, com os schemas e as skills embutidos | nada | ~100 MB |

Também são usados:

- **Git**: para a prova vermelho → verde (`verify --prove`) e para o hub;
- **gh CLI autenticado**: só para abrir as PRs do hub (`hubspec hub pr`);
- **Bun**: só para gerar o `dist/cli.js` ou o binário a partir do código. Não é necessário para usar o hubspec depois.

> O hubspec ainda não está publicado no npm. Por isso `npm i -g hubspec` e `npx hubspec` **não** instalam este projeto. Não use esses comandos: o nome está livre no npm, e eles instalariam outro pacote se alguém registrasse esse nome.

## CLI em Node (recomendado)

```sh
git clone https://github.com/rafaelpolli/hubspec.git ~/hubspec
cd ~/hubspec
bun install                 # só as ferramentas de build (devDependencies)
bun run build               # gera dist/cli.js
mkdir -p ~/.local/bin
ln -sf ~/hubspec/dist/cli.js ~/.local/bin/hubspec
hubspec --version           # 0.4.0
```

A pasta `~/.local/bin` precisa estar no `PATH`. Se não estiver, acrescente `export PATH="$HOME/.local/bin:$PATH"` ao `~/.bashrc` ou ao `~/.zshrc`. Com o npm instalado, `npm install -g .` dentro de `~/hubspec` faz o mesmo que o link.

Para atualizar, gere de novo; o link continua apontando para o arquivo novo:

```sh
cd ~/hubspec && git pull && bun install && bun run build
```

Depois, rode `hubspec update` em cada projeto para receber as skills novas.

## Binário standalone (sem Node)

```sh
cd ~/hubspec
bun run build:bin                                   # dist-bin/hubspec-<plataforma desta máquina>
install -m 755 dist-bin/hubspec-linux-x64 ~/.local/bin/hubspec
```

Para gerar o binário de outras plataformas, informe os alvos. O Bun baixa o runtime de cada uma:

```sh
bun scripts/build.ts --binary linux-arm64 darwin-arm64 windows-x64
```

Os alvos são `linux-x64`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl`, `darwin-x64`, `darwin-arm64`, `windows-x64` e `windows-arm64`. Até agora, só o `linux-x64` foi testado.

Na primeira vez que precisa deles, o binário extrai os schemas e as skills para `~/.local/share/hubspec/binary-files/<hash>/`.

## Plugin do Claude Code (opcional)

O plugin deixa as skills `hubspec-*` e os comandos do hub (`/hubspec:hub:*`) disponíveis em todos os projetos, sem precisar rodar `hubspec init` em cada um. Ele não instala o CLI: instale o `hubspec` antes, como acima.

```
/plugin install hubspec --marketplace rafaelpolli/hubspec
```

Antes do Claude Code 2.1.275, são dois passos: `/plugin marketplace add rafaelpolli/hubspec` e depois `/plugin install hubspec@hubspec`.

Se o repositório for privado, o Claude Code precisa conseguir cloná-lo com as credenciais do Git desta máquina.

## Completions do shell

```sh
hubspec completion install        # detecta o shell; ou: hubspec completion install zsh
```

## Ao lado de um OpenSpec instalado

Pode ter os dois na mesma máquina. A config e os dados globais do hubspec ficam em `~/.config/hubspec/` e `~/.local/share/hubspec/`, separados dos do OpenSpec.

Num mesmo projeto, use só um dos dois para gerar os arquivos:

- O `hubspec init` e o `hubspec update` geram as skills `/opsx` chamando `hubspec`, e a de archive passando pelo portão.
- Um `openspec update` reescreve essas skills para chamar `openspec`, sem o portão. As skills `hubspec-*` continuam lá.
- Se isso acontecer, rode `hubspec update` de novo.

## Desinstalar

```sh
rm ~/.local/bin/hubspec
rm -rf ~/.config/hubspec ~/.local/share/hubspec     # config e dados globais, se quiser
```

Os projetos continuam funcionando com o OpenSpec. O `openspec/` e as changes seguem o formato dele, e as skills `hubspec-*` são apenas arquivos que você pode apagar.
