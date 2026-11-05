import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMap, isSeq, parseDocument, YAMLMap, YAMLSeq } from "yaml";

const START = "<!-- hubspec:inicio -->";
const END = "<!-- hubspec:fim -->";
/** Marks hubspec's own rules, so a later run replaces them and keeps the user's. */
const PREFIX = "Hub:";

/**
 * The hub's rules as OpenSpec project context: the standard propose and apply workflows give
 * `context` to the agent for every artifact and for apply, and `rules.<artifact>` for that
 * artifact. So the rules reach the agent even through the stock /opsx commands.
 */
export const HUB_CONTEXT = `${START}
Este repositório é o hub de um sistema multi-repo: repos.yaml lista os repositórios, docs/ tem a documentação deles e o código fica nos clones em workspace/<repo>/. Siga o AGENTS.md da raiz.
- Antes de propor ou implementar, leia docs/system-overview.md e depois docs/repos/<repo>/ dos repos envolvidos; abra o código em workspace/<repo>/ só quando a doc não bastar.
- Uma mudança que atravessa repos é uma change só, aqui no hub.
- No apply, implemente cada task dentro de workspace/<repo>/ do repo indicado, na ordem do tasks.md; não comece nada enquanto houver uma task [manual] aberta antes.
- Num repo com template: true no repos.yaml, siga a estrutura do template e não a recrie.
${END}`;

export const HUB_RULES: Record<string, string[]> = {
  proposal: [`${PREFIX} diga em quais repos do repos.yaml a mudança acontece e o que muda em cada um.`],
  tasks: [
    `${PREFIX} toda task começa com o repo entre colchetes, um nome do repos.yaml, ou com [manual], e termina com o componente ou caminho alvo, como em: - [ ] 2.1 [api] Publicar o evento PixRecebido — \`src/events/\``,
    `${PREFIX} agrupe as tasks por repo, uma seção por repo (## 2. api), na ordem de dependência: primeiro quem os outros consomem; declare as dependências da change no título da seção, como em: ## 3. worker (depende de: api).`,
    `${PREFIX} um repo novo não é criado pelo agente: a primeira seção é "## 1. Manual" com a task [manual] "criar repo via issue na automação da organização", que bloqueia as demais.`,
  ],
};

/** Guidance for the apply workflow, given to the agent as `operationGuidance`. */
export const HUB_APPLY_GUIDANCE = [
  `${PREFIX} implemente cada task dentro de workspace/<repo>/, o clone do repo entre colchetes; nunca no próprio hub.`,
  `${PREFIX} siga a ordem do tasks.md; com uma task [manual] aberta, pare e peça ao usuário para concluí-la.`,
  `${PREFIX} não faça commit nos clones: o \`hubspec hub pr <change>\` faz isso na branch da change.`,
];

/** Puts hubspec's block inside a context text, keeping what the user wrote around it. */
function withBlock(context: string): string {
  const s = context.indexOf(START);
  const e = context.indexOf(END);
  if (s >= 0 && e > s) return context.slice(0, s) + HUB_CONTEXT + context.slice(e + END.length);
  return context.trim() ? `${context.trimEnd()}\n\n${HUB_CONTEXT}\n` : `${HUB_CONTEXT}\n`;
}

/** Sets the list at `path` to the user's entries (those without the prefix) followed by ours. */
function mergeList(doc: ReturnType<typeof parseDocument>, path: string[], ours: readonly string[]): void {
  for (let i = 1; i < path.length; i++) {
    if (!isMap(doc.getIn(path.slice(0, i)))) doc.setIn(path.slice(0, i), new YAMLMap());
  }
  const current = doc.getIn(path);
  const theirs = isSeq(current) ? (current as YAMLSeq).toJSON().filter((r: unknown) => typeof r === "string" && !r.startsWith(PREFIX)) : [];
  doc.setIn(path, doc.createNode([...theirs, ...ours]));
}

/**
 * Writes the hub's context, artifact rules and apply guidance into `openspec/config.yaml`,
 * keeping its other keys, comments and the user's own entries. Idempotent.
 */
export function writeHubConfig(hub: string): void {
  const file = join(hub, "openspec", "config.yaml");
  let doc = parseDocument(existsSync(file) ? readFileSync(file, "utf8") : "");
  if (!isMap(doc.contents)) doc = parseDocument("schema: spec-driven\n");
  const context = doc.get("context");
  doc.set("context", withBlock(typeof context === "string" ? context : ""));
  for (const [artifact, ours] of Object.entries(HUB_RULES)) mergeList(doc, ["rules", artifact], ours);
  mergeList(doc, ["operations", "apply", "guidance"], HUB_APPLY_GUIDANCE);
  writeFileSync(file, doc.toString({ lineWidth: 0 }));
}
